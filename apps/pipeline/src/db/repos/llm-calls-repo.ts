import type { LlmLedger, LlmLedgerRow } from '../../agents/cost-gate.js'
import { taipeiDateOf } from '@suanomics/shared'
import { and, desc, eq, gte, lt, sql } from 'drizzle-orm'
import { getDb } from '../client.js'
import { llmCalls } from '../schema.js'

const DAY_MS = 86_400_000

const COUNT = sql<number>`count(*)::int`
const USD = sql<string>`coalesce(sum(${llmCalls.costUsd}), 0)`
const FAILED = sql<number>`(count(*) filter (where ${llmCalls.status} <> 'ok'))::int`
const RETRIES = sql<number>`coalesce(sum(${llmCalls.attempts} - 1), 0)::int`

/** 用量查詢的「當日」是花錢當下的台北日期，不是 report_date：補跑舊日期也是今天花的錢。 */
export function taipeiDayRange(now: Date): { start: Date, end: Date } {
  const start = new Date(`${taipeiDateOf(now)}T00:00:00+08:00`)
  return { start, end: new Date(start.getTime() + DAY_MS) }
}

export const dbLedger = {
  async insert(row: LlmLedgerRow): Promise<void> {
    await getDb()
      .insert(llmCalls)
      .values({ ...row, costUsd: row.costUsd === null ? null : row.costUsd.toFixed(10) })
      .onConflictDoNothing({ target: llmCalls.id })
  },
} satisfies LlmLedger

export interface RunUsage {
  totalUsd: number
  calls: number
  failed: number
  retries: number
  byAgent: { agent: string, calls: number, failed: number, retries: number, usd: number }[]
}

export async function getRunUsage(runId: string): Promise<RunUsage> {
  const rows = await getDb()
    .select({ agent: llmCalls.agent, calls: COUNT, failed: FAILED, retries: RETRIES, usd: USD })
    .from(llmCalls)
    .where(eq(llmCalls.runId, runId))
    .groupBy(llmCalls.agent)
    .orderBy(desc(USD), llmCalls.agent)
  const byAgent = rows.map(r => ({ ...r, usd: Number(r.usd) }))
  return {
    totalUsd: byAgent.reduce((sum, a) => sum + a.usd, 0),
    calls: byAgent.reduce((sum, a) => sum + a.calls, 0),
    failed: byAgent.reduce((sum, a) => sum + a.failed, 0),
    retries: byAgent.reduce((sum, a) => sum + a.retries, 0),
    byAgent,
  }
}

interface UsageBucket { calls: number, usd: number }

export interface DailyUsage {
  day: string
  totalUsd: number
  calls: number
  failed: number
  byAgent: ({ agent: string } & UsageBucket)[]
  byModel: ({ model: string } & UsageBucket)[]
}

function addTo<K extends string>(list: (Record<K, string> & UsageBucket)[], key: K, name: string, calls: number, usd: number): void {
  const found = list.find(b => b[key] === name)
  if (found) {
    found.calls += calls
    found.usd += usd
    return
  }
  list.push({ [key]: name, calls, usd } as Record<K, string> & UsageBucket)
}

export async function getDailyUsage(days: number, now: Date = new Date()): Promise<DailyUsage[]> {
  const { start, end } = taipeiDayRange(now)
  const day = sql<string>`to_char(${llmCalls.createdAt} AT TIME ZONE 'Asia/Taipei', 'YYYY-MM-DD')`
  const rows = await getDb()
    .select({ day, agent: llmCalls.agent, model: llmCalls.model, calls: COUNT, failed: FAILED, usd: USD })
    .from(llmCalls)
    .where(and(gte(llmCalls.createdAt, new Date(start.getTime() - (days - 1) * DAY_MS)), lt(llmCalls.createdAt, end)))
    .groupBy(day, llmCalls.agent, llmCalls.model)

  const byDay = new Map<string, DailyUsage>()
  for (const r of rows) {
    const usd = Number(r.usd)
    const bucket: DailyUsage = byDay.get(r.day) ?? { day: r.day, totalUsd: 0, calls: 0, failed: 0, byAgent: [], byModel: [] }
    byDay.set(r.day, bucket)
    bucket.totalUsd += usd
    bucket.calls += r.calls
    bucket.failed += r.failed
    addTo(bucket.byAgent, 'agent', r.agent, r.calls, usd)
    addTo(bucket.byModel, 'model', r.model, r.calls, usd)
  }
  return [...byDay.values()].sort((a, b) => b.day.localeCompare(a.day))
}
