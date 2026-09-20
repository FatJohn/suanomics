// One-shot script: check local DB state for debug
/* eslint-disable no-console -- worker progress logging, structured logger TBD */
import process from 'node:process'
import { getDb } from '@suanomics/db/client'
import { dailyBriefs, newsItems } from '@suanomics/db/schema'
import { sql } from 'drizzle-orm'

async function main() {
  const db = getDb()
  const r1 = await db.select({ count: sql<number>`count(*)::int` }).from(dailyBriefs)
  const r2 = await db.select({ count: sql<number>`count(*)::int` }).from(newsItems)
  const r3 = await db.select({ count: sql<number>`count(*)::int` }).from(newsItems).where(sql`fetched_at > NOW() - INTERVAL '7 days'`)
  console.log('daily_briefs rows:', r1[0])
  console.log('news_items total:', r2[0])
  console.log('news_items recent 7d:', r3[0])
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
