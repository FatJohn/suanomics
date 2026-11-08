import type { SourceFetchDay } from '../../ingest/news/source-failure-alert.js'
import { desc, gte, sql } from 'drizzle-orm'
import { getDb } from '../client.js'
import { sourceFetchResults } from '../schema.js'

export interface SourceFetchInput { slug: string, failed: boolean, httpStatus: number | null }

// 同日重跑（--force）覆寫同一列，否則一天跑兩次會被算成連續兩天失敗。
export async function recordSourceFetchResults(runDate: string, results: readonly SourceFetchInput[]): Promise<void> {
  if (results.length === 0)
    return
  await getDb().insert(sourceFetchResults).values(results.map(r => ({ runDate, slug: r.slug, failed: r.failed, httpStatus: r.httpStatus }))).onConflictDoUpdate({
    target: [sourceFetchResults.runDate, sourceFetchResults.slug],
    set: { failed: sql`excluded.failed`, httpStatus: sql`excluded.http_status`, recordedAt: sql`now()` },
  })
}

export async function getSourceFetchHistory(since: string): Promise<Map<string, SourceFetchDay[]>> {
  const rows = await getDb().select().from(sourceFetchResults).where(gte(sourceFetchResults.runDate, since)).orderBy(desc(sourceFetchResults.runDate))
  const history = new Map<string, SourceFetchDay[]>()
  for (const row of rows) {
    const days = history.get(row.slug) ?? []
    days.push({ runDate: row.runDate, failed: row.failed, httpStatus: row.httpStatus })
    history.set(row.slug, days)
  }
  return history
}
