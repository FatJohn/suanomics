import { and, eq } from 'drizzle-orm'
import { getDb } from '../client.js'
import { dailyBriefs } from '../schema.js'

// where 帶上寫稿時讀到的 brief_json：寫稿期間 brief 被 --force 重跑的話，舊稿與舊音檔不會寫到新 brief 上（#132）。
async function updateBrief(briefDate: string, briefJson: unknown, values: Partial<typeof dailyBriefs.$inferInsert>): Promise<void> {
  const rows = await getDb().update(dailyBriefs).set(values).where(and(eq(dailyBriefs.briefDate, briefDate), eq(dailyBriefs.briefJson, briefJson))).returning({ id: dailyBriefs.id })
  if (rows.length === 0)
    throw new Error(`${briefDate} 沒有 daily_briefs 列可寫入 podcast，或 brief 已在寫稿期間重跑`)
}

export function savePodcastJson(briefDate: string, briefJson: unknown, podcast: unknown): Promise<void> {
  return updateBrief(briefDate, briefJson, { podcastJson: podcast })
}

export function savePodcastAudio(briefDate: string, briefJson: unknown, url: string): Promise<void> {
  return updateBrief(briefDate, briefJson, { podcastAudioPath: url, podcastAudioGeneratedAt: new Date() })
}
