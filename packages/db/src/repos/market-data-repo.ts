import { getDb } from '@suanomics/db/client'
import { marketDataPoints } from '@suanomics/db/schema'
import { and, desc, eq, lte, sql } from 'drizzle-orm'

export interface MarketDataPointInput { seriesId: string, date: string, value: number }

export async function upsertMarketDataPoints(points: MarketDataPointInput[]): Promise<number> {
  if (points.length === 0)
    return 0

  // 1) 過濾非有限值（NaN / Infinity）— numeric 欄位塞不進去、skip 不 throw。
  // 2) 同批 (seriesId, date) 去重：Postgres ON CONFLICT 不能在同一 command 二次影響同 row。
  //    用 Map last-wins、與 upsert 的 do-update 語意一致。
  const dedup = new Map<string, MarketDataPointInput>()
  for (const p of points) {
    if (!Number.isFinite(p.value)) {
      console.warn(`upsertMarketDataPoints: skipping non-finite value for ${p.seriesId}@${p.date}: ${p.value}`)
      continue
    }
    dedup.set(`${p.seriesId}|${p.date}`, p)
  }
  const rows = [...dedup.values()]
  if (rows.length === 0)
    return 0

  const db = getDb()
  const inserted = await db.insert(marketDataPoints)
    .values(rows.map(p => ({ seriesId: p.seriesId, date: p.date, value: String(p.value) })))
    .onConflictDoUpdate({
      target: [marketDataPoints.seriesId, marketDataPoints.date],
      set: { value: sql`excluded.value`, fetchedAt: sql`now()` },
    })
    .returning({ id: marketDataPoints.id })
  return inserted.length
}

/**
 * 某序列最新的 `limit` 個點（新到舊）。
 *
 * `asOf`（`YYYY-MM-DD`、含當日）是**上界**：補跑歷史報告時，快照不可以拿到報告日之後的點。
 * 沒有它的話 2026-09-02 的報告會在正文寫「9/4 收盤的費半 11,735 點」——日期標得誠實，
 * 但那天還不存在，而且沒有任何一層會叫（2026-09-05 本機補跑實際踩到）。
 * 不帶 `asOf` 就是無上界，給「當下最新值」那類呼叫端用（`/api/market/snapshot` 的關鍵數字卡、
 * refresh 算衍生序列）——那些要的正是最新，不是某個報告日的視角。
 */
export async function getLatestPoints(seriesId: string, limit: number, asOf?: string): Promise<{ date: string, value: number }[]> {
  const db = getDb()
  const rows = await db.select({ date: marketDataPoints.date, value: marketDataPoints.value })
    .from(marketDataPoints)
    .where(asOf === undefined
      ? eq(marketDataPoints.seriesId, seriesId)
      : and(eq(marketDataPoints.seriesId, seriesId), lte(marketDataPoints.date, asOf)))
    .orderBy(desc(marketDataPoints.date))
    .limit(limit)
  // drizzle numeric 回 string、date 回 'YYYY-MM-DD' string；value 轉 Number
  return rows.map(r => ({ date: r.date, value: Number(r.value) }))
}
