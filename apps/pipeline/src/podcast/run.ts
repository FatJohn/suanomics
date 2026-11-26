import type { MarketBrief, Podcast } from '@suanomics/shared'
import { Buffer } from 'node:buffer'
import { MarketBriefSchema, PodcastSchema } from '@suanomics/shared'
import { azureBillableChars, buildAzureSsml, DEFAULT_AZURE_RATE, DEFAULT_AZURE_VOICE } from './azure-tts-client.js'
import { segmentPodcastScript } from './script-builder.js'

// 31 天 x 15,000 = 465,000，每天都跑也不超過 Azure F0 每月 50 萬計費字元。
export const MAX_EPISODE_BILLABLE_CHARS = 15_000
// act body 上限 800 字，整段一次送；約 3 分鐘音檔，遠低於 Azure 單次 10 分鐘截斷，
// 一集最多 7 次請求，也在 F0 每 60 秒 20 次之內。
const SEGMENT_MAX_CHARS = 800

export interface PodcastRow {
  status: string
  briefJson: unknown
  podcastJson: unknown
  podcastAudioPath: string | null
  runInputs: unknown
}

export type PodcastLogEvent
  = | { event: 'podcast_script', date: string, reused: boolean }
    | { event: 'podcast_tts', date: string, segments: number, billableChars: number }

export interface PodcastDeps {
  loadRow: (date: string) => Promise<PodcastRow | null>
  /** runInputs 是 daily 存下的 generateBrief 輸入，寫稿用它的市場與敘事線素材，與 brief 同一份。 */
  writeScript: (date: string, brief: MarketBrief, runInputs: unknown) => Promise<Podcast | null>
  savePodcast: (date: string, podcast: Podcast) => Promise<void>
  synthesize: (ssml: string) => Promise<Buffer>
  /** 上傳後回傳公開網址。 */
  upload: (key: string, mp3: Buffer) => Promise<string>
  saveAudio: (date: string, url: string) => Promise<void>
  log: (event: PodcastLogEvent) => void
  maxBillableChars?: number
}

export type PodcastResult
  = | { status: 'skipped', reason: 'no-brief' | 'already-exists', date: string }
    | { status: 'complete', date: string, url: string, segments: number, billableChars: number, bytes: number, reusedScript: boolean }

async function resolveScript(date: string, row: PodcastRow, force: boolean, deps: PodcastDeps): Promise<{ podcast: Podcast, reused: boolean }> {
  // 上次寫好稿但 TTS 或上傳失敗時沿用舊稿，重跑不再花 LLM 費用。
  const existing = PodcastSchema.safeParse(row.podcastJson)
  if (existing.success && !force)
    return { podcast: existing.data, reused: true }
  const brief = MarketBriefSchema.parse(row.briefJson)
  if (!brief.narrative)
    throw new Error(`${date} 的 brief 沒有 narrative，無法寫 podcast 稿`)
  const podcast = await deps.writeScript(date, brief, row.runInputs)
  if (!podcast)
    throw new Error(`${date} 的 podcast-writer 兩次嘗試都失敗`)
  await deps.savePodcast(date, podcast)
  return { podcast, reused: false }
}

export async function runPodcast(options: { date: string, force: boolean }, deps: PodcastDeps): Promise<PodcastResult> {
  const { date, force } = options
  const row = await deps.loadRow(date)
  if (!row || row.status !== 'complete')
    return { status: 'skipped', reason: 'no-brief', date }
  if (row.podcastAudioPath && !force)
    return { status: 'skipped', reason: 'already-exists', date }

  const { podcast, reused } = await resolveScript(date, row, force, deps)
  deps.log({ event: 'podcast_script', date, reused })

  const ssmls = segmentPodcastScript(podcast, { maxChars: SEGMENT_MAX_CHARS })
    .map(s => buildAzureSsml({ text: s.text, voice: DEFAULT_AZURE_VOICE, rate: DEFAULT_AZURE_RATE }))
  const billableChars = ssmls.reduce((sum, s) => sum + azureBillableChars(s), 0)
  const limit = deps.maxBillableChars ?? MAX_EPISODE_BILLABLE_CHARS
  if (billableChars > limit)
    throw new Error(`${date} 的 podcast 計費字元 ${billableChars} 超過單集上限 ${limit}`)
  deps.log({ event: 'podcast_tts', date, segments: ssmls.length, billableChars })

  // 依序送：F0 有每 60 秒 20 次的限制，並行沒有好處。同格式的 MP3 片段直接接起來就能播。
  const parts: Buffer[] = []
  for (const ssml of ssmls)
    parts.push(await deps.synthesize(ssml))
  const mp3 = Buffer.concat(parts)
  const url = await deps.upload(`podcasts/${date}.mp3`, mp3)
  await deps.saveAudio(date, url)
  return { status: 'complete', date, url, segments: ssmls.length, billableChars, bytes: mp3.length, reusedScript: reused }
}
