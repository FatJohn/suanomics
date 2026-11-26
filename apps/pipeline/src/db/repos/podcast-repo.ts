import { eq } from 'drizzle-orm'
import { getDb } from '../client.js'
import { dailyBriefs } from '../schema.js'

async function updateBrief(briefDate: string, values: Partial<typeof dailyBriefs.$inferInsert>): Promise<void> {
  const rows = await getDb().update(dailyBriefs).set(values).where(eq(dailyBriefs.briefDate, briefDate)).returning({ id: dailyBriefs.id })
  if (rows.length === 0)
    throw new Error(`${briefDate} 沒有 daily_briefs 列可寫入 podcast`)
}

export function savePodcastJson(briefDate: string, podcast: unknown): Promise<void> {
  return updateBrief(briefDate, { podcastJson: podcast })
}

export function savePodcastAudio(briefDate: string, url: string): Promise<void> {
  return updateBrief(briefDate, { podcastAudioPath: url, podcastAudioGeneratedAt: new Date() })
}
