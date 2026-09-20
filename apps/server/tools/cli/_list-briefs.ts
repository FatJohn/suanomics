// One-shot script: list daily_briefs rows for debug
/* eslint-disable no-console -- worker progress logging, structured logger TBD */
import process from 'node:process'
import { getDb } from '@suanomics/db/client'
import { sql } from 'drizzle-orm'

async function main() {
  const r = await getDb().execute(sql`
    SELECT brief_date, status, length(coalesce(brief_json::text,'')) AS brief_chars
    FROM daily_briefs
    ORDER BY brief_date DESC
    LIMIT 5
  `)
  console.log((r as { rows?: unknown[] }).rows ?? r)
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
