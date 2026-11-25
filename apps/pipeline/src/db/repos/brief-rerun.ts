import { and, eq, gte } from 'drizzle-orm'
import { getDb } from '../client.js'
import { dailyBriefs } from '../schema.js'

// 只看 complete：incomplete 是花費閘中止的那次，storyline 寫回沒有跑過。
export async function hasCompleteBriefOnOrAfter(briefDate: string): Promise<boolean> {
  const rows = await getDb().select({ id: dailyBriefs.id }).from(dailyBriefs).where(and(eq(dailyBriefs.status, 'complete'), gte(dailyBriefs.briefDate, briefDate))).limit(1)
  return rows.length > 0
}
