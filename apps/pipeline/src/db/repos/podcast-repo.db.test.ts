import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '../client.js'
import { dailyBriefs } from '../schema.js'
import { getDailyBriefByDate, saveDailyBrief } from './news-repo.js'
import { savePodcastAudio, savePodcastJson } from './podcast-repo.js'

// 2094-05 只給本檔用（其他 db 測試用 2093、2095–2099）。
const DATE = '2094-05-01'
// 帶小數、巢狀、null 與全形字：確認讀回的 brief_json 拿來比對仍相等
const BRIEF = { headline: 'H', score: 0.30000000000000004, items: [{ pct: -1.5, note: '台積電「CoWoS」' }], empty: null }

async function cleanup(): Promise<void> {
  await getDb().delete(dailyBriefs).where(eq(dailyBriefs.briefDate, DATE))
}

describe('podcast repo', () => {
  beforeEach(cleanup)
  afterAll(cleanup)

  it('寫入稿子與音檔網址，不動 brief 本身', async () => {
    await saveDailyBrief(DATE, [], 'ok', BRIEF)
    const loaded = (await getDailyBriefByDate(DATE))?.briefJson
    await savePodcastJson(DATE, loaded, { acts: [] })
    const before = Date.now()
    await savePodcastAudio(DATE, loaded, 'https://audio.example.com/podcasts/2094-05-01.mp3')
    const row = await getDailyBriefByDate(DATE)
    expect(row).toMatchObject({ status: 'complete', briefJson: BRIEF, podcastJson: { acts: [] }, podcastAudioPath: 'https://audio.example.com/podcasts/2094-05-01.mp3' })
    expect(row?.podcastAudioGeneratedAt?.getTime()).toBeGreaterThanOrEqual(before - 1000)
  })

  it('brief 重跑覆寫時清掉舊的 podcast 稿與音檔', async () => {
    await saveDailyBrief(DATE, [], 'ok', BRIEF)
    await savePodcastJson(DATE, BRIEF, { acts: [] })
    await savePodcastAudio(DATE, BRIEF, 'https://audio.example.com/podcasts/2094-05-01.mp3')
    await saveDailyBrief(DATE, [], 'rerun', { headline: 'H2' })
    const row = await getDailyBriefByDate(DATE)
    expect(row).toMatchObject({ summary: 'rerun', podcastJson: null, podcastAudioPath: null, podcastAudioGeneratedAt: null })
  })

  it('寫稿期間 brief 被重跑時，不把舊稿與舊音檔寫到新 brief 上', async () => {
    await saveDailyBrief(DATE, [], 'ok', BRIEF)
    await saveDailyBrief(DATE, [], 'rerun', { headline: 'H2' })
    await expect(savePodcastJson(DATE, BRIEF, { acts: [] })).rejects.toThrow(DATE)
    await expect(savePodcastAudio(DATE, BRIEF, 'https://audio.example.com/old.mp3')).rejects.toThrow(DATE)
    const row = await getDailyBriefByDate(DATE)
    expect(row).toMatchObject({ briefJson: { headline: 'H2' }, podcastJson: null, podcastAudioPath: null })
  })

  it('沒有那天的 brief 時丟錯，不默默寫空', async () => {
    await expect(savePodcastJson(DATE, BRIEF, { acts: [] })).rejects.toThrow(DATE)
    await expect(savePodcastAudio(DATE, BRIEF, 'https://x')).rejects.toThrow(DATE)
  })
})
