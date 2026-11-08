import type { CalendarEvent } from '@suanomics/shared'
import type { MaterialAnnouncement } from '../../ingest/market-data/material-announcements.js'
import { count, gte, sql } from 'drizzle-orm'
import { getDb } from '../client.js'
import { econCalendarEvents, materialAnnouncements, newsItems } from '../schema.js'

/** 回傳實際新增的筆數；同一則重訊重跑不重複。 */
export async function insertMaterialAnnouncements(rows: readonly MaterialAnnouncement[]): Promise<number> {
  if (rows.length === 0)
    return 0
  const inserted = await getDb().insert(materialAnnouncements).values([...rows]).onConflictDoNothing().returning({ id: materialAnnouncements.id })
  return inserted.length
}

export async function upsertEconCalendarEvents(events: readonly (CalendarEvent & { source: string })[]): Promise<number> {
  if (events.length === 0)
    return 0
  const unique = new Map(events.map(e => [`${e.date}|${e.title}`, e]))
  const rows = [...unique.values()].map(e => ({ date: e.date, title: e.title, region: e.region, importance: e.importance, source: e.source }))
  await getDb().insert(econCalendarEvents).values(rows).onConflictDoUpdate({
    target: [econCalendarEvents.date, econCalendarEvents.title],
    set: { region: sql`EXCLUDED.region`, importance: sql`EXCLUDED.importance`, source: sql`EXCLUDED.source`, fetchedAt: sql`now()` },
  })
  return rows.length
}

export interface IngestStats {
  total: number
  bodyFetched: number
  bodyRate: number
  byCategory: Record<string, number>
}

/** 本次 ingest 新進新聞的總數、正文取得率（scrape 成功的比例）與分類分布。 */
export async function getIngestStats(since: Date): Promise<IngestStats> {
  const rows = await getDb()
    .select({ category: newsItems.category, contentSource: newsItems.contentSource, n: count() })
    .from(newsItems)
    .where(gte(newsItems.fetchedAt, since))
    .groupBy(newsItems.category, newsItems.contentSource)
  const total = rows.reduce((sum, r) => sum + r.n, 0)
  const bodyFetched = rows.filter(r => r.contentSource === 'scrape').reduce((sum, r) => sum + r.n, 0)
  const byCategory: Record<string, number> = {}
  for (const r of rows)
    byCategory[r.category ?? 'null'] = (byCategory[r.category ?? 'null'] ?? 0) + r.n
  return { total, bodyFetched, bodyRate: total === 0 ? 0 : bodyFetched / total, byCategory }
}
