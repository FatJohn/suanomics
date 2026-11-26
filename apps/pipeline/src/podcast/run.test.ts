import type { MarketBrief, Podcast } from '@suanomics/shared'
import type { PodcastDeps, PodcastRow } from './run.js'
import { Buffer } from 'node:buffer'
import { describe, expect, it, vi } from 'vitest'
import { MAX_EPISODE_BILLABLE_CHARS, runPodcast } from './run.js'

const DATE = '2026-11-26'
const URL = 'https://example.com/a'

const BRIEF: MarketBrief = {
  headline: 'h',
  summary: 's',
  relatedNews: [],
  affectedIndustries: [],
  relatedETFs: [],
  reasoningChain: ['r1', 'r2'],
  citations: [{ url: URL, title: 't', quote: 'q' }],
  disclaimer: '本分析僅供參考、非投資建議、實際投資請諮詢專業人士',
  narrative: {
    intro: '導讀'.repeat(60),
    sections: [{ heading: '主題', takeaway: null, body: '內文'.repeat(150), relatedNewsIds: ['n1'], claimIds: [], citationUrls: [URL] }],
    outro: '結語'.repeat(60),
  },
}

function podcast(actBody = '連動'.repeat(200)): Podcast {
  const act = { actTitle: '八個字以上的標題', storyline: 'ai-tech' as const, body: actBody, citationUrls: [URL], relatedNewsIds: ['n1'] }
  return {
    briefDate: DATE,
    hook: { headline: '這是一個至少二十個字的開場標題、用來通過 schema', body: '開場'.repeat(100) },
    acts: [act, act, act],
    takeaway: { body: '收尾'.repeat(100) },
    meta: { totalChars: 2000, persona: 'panpan', generatedAt: '2026-11-26T00:00:00.000Z' },
  }
}

function deps(row: PodcastRow | null, overrides: Partial<PodcastDeps> = {}): PodcastDeps {
  return {
    loadRow: vi.fn(async () => row),
    writeScript: vi.fn(async () => podcast()),
    savePodcast: vi.fn(async () => {}),
    synthesize: vi.fn(async () => Buffer.from([0xFF, 0xFB])),
    upload: vi.fn(async (key: string) => `https://audio.example.com/${key}`),
    saveAudio: vi.fn(async () => {}),
    log: vi.fn(),
    ...overrides,
  }
}

const RUN_INPUTS = { version: 1 }
const COMPLETE: PodcastRow = { status: 'complete', briefJson: BRIEF, podcastJson: null, podcastAudioPath: null, runInputs: RUN_INPUTS }

describe('runPodcast', () => {
  it('沒有 complete 的 brief 時略過，不呼叫 LLM 或 TTS', async () => {
    for (const row of [null, { ...COMPLETE, status: 'incomplete', briefJson: null }]) {
      const d = deps(row)
      expect(await runPodcast({ date: DATE, force: false }, d)).toEqual({ status: 'skipped', reason: 'no-brief', date: DATE })
      expect(d.writeScript).not.toHaveBeenCalled()
      expect(d.synthesize).not.toHaveBeenCalled()
    }
  })

  it('已有音檔時略過；--force 時重做', async () => {
    const row = { ...COMPLETE, podcastJson: podcast(), podcastAudioPath: 'https://audio.example.com/old.mp3' }
    const skipped = deps(row)
    expect(await runPodcast({ date: DATE, force: false }, skipped)).toEqual({ status: 'skipped', reason: 'already-exists', date: DATE })
    expect(skipped.synthesize).not.toHaveBeenCalled()

    const forced = deps(row)
    expect((await runPodcast({ date: DATE, force: true }, forced)).status).toBe('complete')
    expect(forced.writeScript).toHaveBeenCalledTimes(1)
  })

  it('寫稿、存稿、逐段合成、上傳、存網址，音檔是各段依序接起來', async () => {
    let n = 0
    const d = deps(COMPLETE, { synthesize: vi.fn(async () => Buffer.from([n++])) })
    const result = await runPodcast({ date: DATE, force: false }, d)
    // hook、三個 act、takeaway 各一段（act 400 字，不超過單段上限）
    expect(d.synthesize).toHaveBeenCalledTimes(5)
    expect(d.writeScript).toHaveBeenCalledWith(DATE, expect.objectContaining({ headline: 'h' }), RUN_INPUTS)
    expect(d.savePodcast).toHaveBeenCalledWith(DATE, podcast())
    expect(d.upload).toHaveBeenCalledWith(`podcasts/${DATE}.mp3`, Buffer.from([0, 1, 2, 3, 4]))
    expect(d.saveAudio).toHaveBeenCalledWith(DATE, `https://audio.example.com/podcasts/${DATE}.mp3`)
    expect(result).toMatchObject({ status: 'complete', date: DATE, segments: 5, bytes: 5, reusedScript: false })
  })

  it('已有稿但沒音檔時沿用舊稿，不再花 LLM 費用', async () => {
    const d = deps({ ...COMPLETE, podcastJson: podcast() })
    const result = await runPodcast({ date: DATE, force: false }, d)
    expect(d.writeScript).not.toHaveBeenCalled()
    expect(d.savePodcast).not.toHaveBeenCalled()
    expect(result).toMatchObject({ status: 'complete', reusedScript: true })
  })

  it('寫稿失敗時丟錯，不合成也不寫 DB', async () => {
    const d = deps(COMPLETE, { writeScript: vi.fn(async () => null) })
    await expect(runPodcast({ date: DATE, force: false }, d)).rejects.toThrow(/podcast-writer/)
    expect(d.savePodcast).not.toHaveBeenCalled()
    expect(d.synthesize).not.toHaveBeenCalled()
  })

  it('brief 沒有 narrative 時丟錯', async () => {
    const d = deps({ ...COMPLETE, briefJson: { ...BRIEF, narrative: null } })
    await expect(runPodcast({ date: DATE, force: false }, d)).rejects.toThrow(/narrative/)
    expect(d.writeScript).not.toHaveBeenCalled()
  })

  it('單集上限乘 31 天仍在 Azure F0 每月 50 萬字元內', () => {
    expect(MAX_EPISODE_BILLABLE_CHARS * 31).toBeLessThanOrEqual(500_000)
  })

  it('計費字元超過單集上限時在呼叫 Azure 之前丟錯', async () => {
    const act = { actTitle: '八個字以上的標題', storyline: 'ai-tech' as const, body: '長'.repeat(800), citationUrls: [URL], relatedNewsIds: ['n1'] }
    const d = deps({ ...COMPLETE, podcastJson: { ...podcast(), acts: [act, act, act, act, act] } }, { maxBillableChars: 5_000 })
    await expect(runPodcast({ date: DATE, force: false }, d)).rejects.toThrow(/計費字元/)
    expect(d.synthesize).not.toHaveBeenCalled()
  })
})
