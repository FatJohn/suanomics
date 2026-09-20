// One-shot script: DELETE daily_briefs row + background_jobs audit dedup row by date
// (iter testing 用、繞 producer.findRecentCompleted 24h cache)
// 用法: pnpm --filter server exec tsx --env-file-if-exists=.env tools/cli/_delete-brief.ts <date>
/* eslint-disable no-console -- worker progress logging, structured logger TBD */
import process from 'node:process'
import { getDb } from '@suanomics/db/client'
import { backgroundJobs, dailyBriefs } from '@suanomics/db/schema'
import { hashJobPayload } from '@suanomics/jobs'
import { and, eq } from 'drizzle-orm'

async function main() {
  const date = process.argv[2]
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error('usage: tsx _delete-brief.ts YYYY-MM-DD')
    process.exit(1)
  }
  const db = getDb()
  const deletedBrief = await db.delete(dailyBriefs).where(eq(dailyBriefs.briefDate, date)).returning({ id: dailyBriefs.id })
  console.log(`deleted ${deletedBrief.length} daily_briefs row(s) for brief_date=${date}:`, deletedBrief)

  // 同 payload hash 計算邏輯（@suanomics/jobs 的 hashJobPayload）才能對齊 audit 的 dedup row
  const payloadHash = hashJobPayload({ date })
  const deletedAudit = await db.delete(backgroundJobs).where(
    and(
      eq(backgroundJobs.jobKind, 'daily-brief'),
      eq(backgroundJobs.payloadHash, payloadHash),
    ),
  ).returning({ id: backgroundJobs.id, status: backgroundJobs.status })
  console.log(`deleted ${deletedAudit.length} background_jobs row(s) for payloadHash=${payloadHash.slice(0, 12)}...:`, deletedAudit)
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
