import { getTableColumns, like, sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, getDb } from '../client.js'
import { llmCalls } from '../schema.js'
import { dbLedger, getDailyUsage, getRunUsage, taipeiDayRange } from './llm-calls-repo.js'

const PREFIX = 'ledgertest-'
const NOW = new Date('2001-03-10T12:00:00+08:00')

function row(overrides: Partial<typeof llmCalls.$inferInsert> = {}): typeof llmCalls.$inferInsert {
  return {
    id: crypto.randomUUID(),
    runId: `${PREFIX}a`,
    reportDate: '2001-03-10',
    provider: 'anthropic',
    model: 'claude-haiku-5-5',
    agent: 'news-tagger',
    tokensIn: 1,
    tokensOut: 2,
    cacheReadTokens: 3,
    cacheWriteTokens: 4,
    latencyMs: 5,
    attempts: 1,
    status: 'ok',
    costUsd: '0.1000000000',
    priceVersion: 'v',
    createdAt: new Date('2001-03-10T09:00:00+08:00'),
    ...overrides,
  }
}

async function cleanup(): Promise<void> {
  await getDb().delete(llmCalls).where(like(llmCalls.runId, `${PREFIX}%`))
}

describe('llm_calls（real DB）', () => {
  beforeEach(cleanup)
  afterAll(async () => {
    await cleanup()
    await closeDb()
  })

  it('schema 沒有 provider 專屬欄位', () => {
    expect(Object.keys(getTableColumns(llmCalls)).filter(c => /anthropic|claude|openai|gemini/i.test(c))).toEqual([])
  })

  it('同一 id 重寫不產生第二列', async () => {
    const entry = {
      id: crypto.randomUUID(),
      runId: `${PREFIX}dup`,
      reportDate: '2001-03-10',
      provider: 'anthropic',
      model: 'm',
      agent: 'news-tagger',
      tokensIn: 1,
      tokensOut: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      latencyMs: 1,
      attempts: 1,
      status: 'ok' as const,
      costUsd: 0.123456789,
      priceVersion: 'v',
    }
    await dbLedger.insert(entry)
    await dbLedger.insert(entry)
    const rows = await getDb().select().from(llmCalls).where(like(llmCalls.runId, `${PREFIX}dup`))
    expect(rows).toHaveLength(1)
    expect(Number(rows[0]?.costUsd)).toBeCloseTo(0.123456789, 9)
  })

  it('getRunUsage 依 agent 拆分、統計失敗與重試，null 成本不出錯', async () => {
    await getDb().insert(llmCalls).values([
      row({ agent: 'editor', costUsd: '0.2000000000', attempts: 3 }),
      row({ agent: 'editor', costUsd: '0.3000000000' }),
      row({ agent: 'decomposer', costUsd: null, status: 'failed', attempts: 2 }),
      row({ runId: `${PREFIX}other`, agent: 'editor', costUsd: '5.0000000000' }),
    ])
    const usage = await getRunUsage(`${PREFIX}a`)
    expect(usage.calls).toBe(3)
    expect(usage.failed).toBe(1)
    expect(usage.retries).toBe(3)
    expect(usage.totalUsd).toBeCloseTo(0.5, 10)
    expect(usage.byAgent.map(a => a.agent)).toEqual(['editor', 'decomposer'])
    expect(usage.byAgent[1]).toMatchObject({ calls: 1, failed: 1, usd: 0 })
  })

  it('getDailyUsage 回近 N 天，與直接 SQL 加總一致', async () => {
    await getDb().insert(llmCalls).values([
      row({ costUsd: '0.1000000000' }),
      row({ model: 'claude-sonnet-5-5', agent: 'editor', costUsd: '0.2000000000' }),
      row({ costUsd: '0.4000000000', createdAt: new Date('2001-03-09T23:00:00+08:00') }),
      row({ costUsd: '7.0000000000', createdAt: new Date('2001-03-08T23:59:59+08:00') }),
      row({ costUsd: null, status: 'failed', createdAt: new Date('2001-03-09T23:00:00+08:00') }),
    ])
    const days = await getDailyUsage(2, NOW)
    expect(days.map(d => d.day)).toEqual(['2001-03-10', '2001-03-09'])
    expect(days[0]?.totalUsd).toBeCloseTo(0.3, 10)
    expect(days[0]?.byModel.map(m => m.model).sort()).toEqual(['claude-haiku-5-5', 'claude-sonnet-5-5'])
    expect(days[0]?.byAgent.find(a => a.agent === 'editor')?.usd).toBeCloseTo(0.2, 10)
    expect(days[1]).toMatchObject({ calls: 2, failed: 1 })

    const { start, end } = taipeiDayRange(NOW)
    const rows = await getDb().select({ usd: sql<string>`sum(${llmCalls.costUsd})` }).from(llmCalls).where(sql`${llmCalls.createdAt} >= ${start.toISOString()} AND ${llmCalls.createdAt} < ${end.toISOString()}`)
    expect(days[0]?.totalUsd).toBeCloseTo(Number(rows[0]?.usd), 10)
  })
})

describe('taipeiDayRange', () => {
  it('台北 00:30 仍屬當天，範圍是台北日的 UTC 起訖', () => {
    const { start, end } = taipeiDayRange(new Date('2026-11-09T16:30:00Z'))
    expect(start.toISOString()).toBe('2026-11-09T16:00:00.000Z')
    expect(end.toISOString()).toBe('2026-11-10T16:00:00.000Z')
  })
})
