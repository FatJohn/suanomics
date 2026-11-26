import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '../client.js'
import { dailyBriefs } from '../schema.js'
import { getDailyBriefByDate, saveDailyBrief } from './news-repo.js'
import { savePodcastAudio, savePodcastJson } from './podcast-repo.js'

// 2094-05 只給本檔用（其他 db 測試用 2093、2095–2099）。
const DATE = '2094-05-01'

async function cleanup(): Promise<void> {
  await getDb().delete(dailyBriefs).where(eq(dailyBriefs.briefDate, DATE))
}

describe('podcast repo', () => {
  beforeEach(cleanup)
  afterAll(cleanup)

  it('寫入稿子與音檔網址，不動 brief 本身', async () => {
    await saveDailyBrief(DATE, [], 'ok', { headline: 'H' })
    await savePodcastJson(DATE, { acts: [] })
    const before = Date.now()
    await savePodcastAudio(DATE, 'https://audio.example.com/podcasts/2094-05-01.mp3')
    const row = await getDailyBriefByDate(DATE)
    expect(row).toMatchObject({ status: 'complete', briefJson: { headline: 'H' }, podcastJson: { acts: [] }, podcastAudioPath: 'https://audio.example.com/podcasts/2094-05-01.mp3' })
    expect(row?.podcastAudioGeneratedAt?.getTime()).toBeGreaterThanOrEqual(before - 1000)
  })

  it('沒有那天的 brief 時丟錯，不默默寫空', async () => {
    await expect(savePodcastJson(DATE, { acts: [] })).rejects.toThrow(DATE)
    await expect(savePodcastAudio(DATE, 'https://x')).rejects.toThrow(DATE)
  })
})
