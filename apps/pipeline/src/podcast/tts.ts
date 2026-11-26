/* eslint-disable no-console -- worker progress logging, structured logger TBD */
import type { Podcast } from '@suanomics/shared'
import type { Buffer } from 'node:buffer'
import type { PodcastSegment } from '../podcast-tts/script-builder.js'
import process from 'node:process'
import { getDb } from '@suanomics/db/client'
import { dailyBriefs } from '@suanomics/db/schema'
import { getPodcastStorage } from '@suanomics/db/storage/podcast-storage'
import { PodcastSchema } from '@suanomics/shared'
import { eq } from 'drizzle-orm'
import { DEFAULT_AZURE_RATE, DEFAULT_AZURE_VOICE, synthesizeAzure } from '../podcast-tts/azure-tts-client.js'
import { DEFAULT_PODCAST_VOICE, synthesize } from '../podcast-tts/gemini-tts-client.js'
import { encodeMp3 } from '../podcast-tts/mp3-encode.js'
import { concatPcmSegments, DEFAULT_GAP_MS } from '../podcast-tts/pcm-concat.js'
import { buildFullScript, segmentPodcastScript } from '../podcast-tts/script-builder.js'
import { computeSegmentTimecodes } from '../podcast-tts/segment-timecodes.js'

export interface RunPodcastTtsArgs {
  date: string
}

export interface SegmentMeta {
  section: PodcastSegment['section']
  sectionIndex: number
  startMs: number
  durationMs: number
}

export interface RunPodcastTtsResult {
  briefDate: string
  storedPath: string
  bytes: number
  scriptChars: number
  ttsLatencyMs: number
  skipped: boolean // true 表 audio 已存在、未重跑
  provider: string
  voice: string
  segmentCount: number
  segments: SegmentMeta[]
}

interface EpisodeAudio {
  mp3: Buffer
  voice: string
  scriptChars: number
  ttsLatencyMs: number
  segments: SegmentMeta[]
}

// Gemini：per-call 會漂、故切段 → 逐段 synth → PCM 合一 → encode（含 timecodes）。
async function synthesizeGeminiEpisode(podcast: Podcast): Promise<EpisodeAudio> {
  const segments = segmentPodcastScript(podcast)
  const voice = process.env.PODCAST_TTS_VOICE ?? DEFAULT_PODCAST_VOICE
  console.log(`[runPodcastTts] gemini: ${segments.length} segments, voice=${voice}`)

  const t0 = Date.now()
  const pcms: Buffer[] = []
  let sampleRate = 0
  for (const seg of segments) {
    const r = await synthesize({ text: seg.text, voice })
    if (sampleRate === 0)
      sampleRate = r.sampleRate
    else if (r.sampleRate !== sampleRate)
      throw new Error(`runPodcastTts: sampleRate mismatch ${r.sampleRate} vs ${sampleRate}`)
    pcms.push(r.pcm)
  }
  const ttsLatencyMs = Date.now() - t0

  const full = concatPcmSegments(pcms, { sampleRate, gapMs: DEFAULT_GAP_MS })
  const mp3 = encodeMp3(full, { sampleRate, channels: 2 })
  const timecodes = computeSegmentTimecodes(pcms.map(b => b.length), { sampleRate, gapMs: DEFAULT_GAP_MS })
  const segMeta = segments.map((s, i) => {
    // eslint-disable-next-line ts/no-non-null-assertion -- timecodes 與 segments 1:1 對齊
    const tc = timecodes[i]!
    return { section: s.section, sectionIndex: s.sectionIndex, startMs: tc.startMs, durationMs: tc.durationMs }
  })
  return { mp3, voice, scriptChars: segments.reduce((n, s) => n + s.text.length, 0), ttsLatencyMs, segments: segMeta }
}

// Azure：neural 穩定、無 per-call 漂移、可吃長文 → 整集一次請求拿回 mp3、不切段。
async function synthesizeAzureEpisode(podcast: Podcast): Promise<EpisodeAudio> {
  const text = buildFullScript(podcast)
  // voice/rate 在此一處解析（opts ?? env ?? default）並顯式傳入、避免與 client 兩層解析不一致
  const voice = process.env.AZURE_SPEECH_VOICE ?? DEFAULT_AZURE_VOICE
  const rate = process.env.AZURE_SPEECH_RATE ?? DEFAULT_AZURE_RATE
  console.log(`[runPodcastTts] azure: ${text.length} chars, voice=${voice}, rate=${rate}`)

  const t0 = Date.now()
  const mp3 = await synthesizeAzure({ text, voice, rate })
  return { mp3, voice, scriptChars: text.length, ttsLatencyMs: Date.now() - t0, segments: [] }
}

export async function runPodcastTts(args: RunPodcastTtsArgs): Promise<RunPodcastTtsResult> {
  const { date } = args
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
    throw new Error(`runPodcastTts: invalid date format ${date}`)

  const db = getDb()
  const rows = await db
    .select()
    .from(dailyBriefs)
    .where(eq(dailyBriefs.briefDate, date))
    .limit(1)

  const row = rows[0]
  if (!row)
    throw new Error(`runPodcastTts: no daily_brief row for ${date}`)

  // Idempotency：若 audio 已存在、skip 並回舊路徑、讓 retry 不重燒 TTS
  if (row.podcastAudioPath) {
    console.log(`[runPodcastTts] skip ${date}: audio already exists at ${row.podcastAudioPath}`)
    return {
      briefDate: date,
      storedPath: row.podcastAudioPath,
      bytes: 0,
      scriptChars: 0,
      ttsLatencyMs: 0,
      skipped: true,
      provider: '',
      voice: '',
      segmentCount: 0,
      segments: [],
    }
  }

  const parsed = PodcastSchema.safeParse(row.podcastJson)
  if (!parsed.success)
    throw new Error(`runPodcastTts: podcast_json is null/invalid for ${date}; run podcast:generate first.`)

  // 正規化：只有 'azure' 走 Azure、其餘（含未設 / 未知值）一律 fallback gemini。
  // provider 報告解析後的實際路徑、非原始 env 字串。
  //
  // ★ gemini 那條路徑的 encodeMp3 是同步、CPU-bound 的：整段音檔在一次呼叫裡編完，
  //   期間這個 process 的 event loop 完全不動，於是 HTTP 也一起停住（HTTP 與 job 執行
  //   自 2026-09-04 起同一個 process）。prod 走 azure、Azure 直接回 MP3，不經過這段，
  //   所以現況沒有這個問題。要把 gemini 拿回 prod 之前，先把這段丟到 worker_thread。
  const provider = process.env.PODCAST_TTS_PROVIDER === 'azure' ? 'azure' : 'gemini'
  const episode = provider === 'azure'
    ? await synthesizeAzureEpisode(parsed.data)
    : await synthesizeGeminiEpisode(parsed.data)

  const storage = getPodcastStorage()
  const storedPath = await storage.save(date, episode.mp3)
  console.log(`[runPodcastTts] saved -> ${storedPath} (${episode.mp3.length}B, provider=${provider}, ${episode.ttsLatencyMs}ms)`)

  await db.update(dailyBriefs)
    .set({ podcastAudioPath: storedPath, podcastAudioGeneratedAt: new Date() })
    .where(eq(dailyBriefs.briefDate, date))

  return {
    briefDate: date,
    storedPath,
    bytes: episode.mp3.length,
    scriptChars: episode.scriptChars,
    ttsLatencyMs: episode.ttsLatencyMs,
    skipped: false,
    provider,
    voice: episode.voice,
    segmentCount: episode.segments.length,
    segments: episode.segments,
  }
}
