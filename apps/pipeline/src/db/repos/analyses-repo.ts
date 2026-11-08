import type { MarketBrief } from '@suanomics/shared'
import { and, desc, eq, gte, isNull, or, sql } from 'drizzle-orm'
import { getDb } from '../client.js'
import { analyses } from '../schema.js'

export interface CachedAnalysis {
  id: number
  payload: MarketBrief
  entities: string[]
  expiresAt: Date | null
}

export async function findCachedByInputHash(inputHash: string): Promise<CachedAnalysis | null> {
  const rows = await getDb()
    .select({
      id: analyses.id,
      payload: analyses.payload,
      entities: analyses.entities,
      expiresAt: analyses.expiresAt,
    })
    .from(analyses)
    .where(and(
      eq(analyses.inputHash, inputHash),
      or(isNull(analyses.expiresAt), gte(analyses.expiresAt, new Date())),
    ))
    .orderBy(desc(analyses.createdAt))
    .limit(1)
  if (rows.length === 0)
    return null
  // eslint-disable-next-line ts/no-non-null-assertion -- rows.length guard above ensures element exists
  const r = rows[0]!
  return {
    id: r.id,
    payload: r.payload as MarketBrief,
    entities: (r.entities as string[]) ?? [],
    expiresAt: r.expiresAt,
  }
}

export async function findCachedByEntityOverlap(
  canonical: string[],
  windowDays: number,
  limit: number,
): Promise<CachedAnalysis[]> {
  if (canonical.length === 0)
    return []
  const since = new Date(Date.now() - windowDays * 86_400_000)
  // 每個 canonical entity 一個 @> clause、再 OR 起來、ANY-match
  const orClauses = canonical.map(c =>
    sql`${analyses.entities} @> ${JSON.stringify([c])}::jsonb`,
  )
  const rows = await getDb()
    .select({
      id: analyses.id,
      payload: analyses.payload,
      entities: analyses.entities,
      expiresAt: analyses.expiresAt,
    })
    .from(analyses)
    // eslint-disable-next-line ts/no-non-null-assertion -- canonical.length > 0 guard above ensures or() is non-null
    .where(and(gte(analyses.createdAt, since), or(...orClauses)!))
    .orderBy(desc(analyses.createdAt))
    .limit(limit)
  return rows.map(r => ({
    id: r.id,
    payload: r.payload as MarketBrief,
    entities: (r.entities as string[]) ?? [],
    expiresAt: r.expiresAt,
  }))
}

export async function getAnalysisById(id: number): Promise<{ id: number, payload: MarketBrief } | null> {
  const rows = await getDb()
    .select({ id: analyses.id, payload: analyses.payload })
    .from(analyses)
    .where(eq(analyses.id, id))
    .limit(1)
  if (rows.length === 0)
    return null
  // eslint-disable-next-line ts/no-non-null-assertion -- rows.length guard above ensures element exists
  return { id: rows[0]!.id, payload: rows[0]!.payload as MarketBrief }
}
