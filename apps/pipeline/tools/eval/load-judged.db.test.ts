import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '../../src/db/client.js'
import { SHADOW_RUN_ID_PREFIX } from '../../src/db/repos/shadow-briefs-repo.js'
import { llmCalls } from '../../src/db/schema.js'
import { loadJudgedAgents } from './load-inputs.js'

const DATE = '2093-07-10'

function row(runId: string, agent: string): typeof llmCalls.$inferInsert {
  return {
    id: crypto.randomUUID(),
    runId,
    reportDate: DATE,
    provider: 'anthropic',
    model: 'm',
    agent,
    tokensIn: 1,
    tokensOut: 1,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    latencyMs: 1,
    attempts: 1,
    status: 'ok',
    costUsd: '0.1',
    priceVersion: 'v',
  }
}

async function cleanup(): Promise<void> {
  await getDb().delete(llmCalls).where(eq(llmCalls.reportDate, DATE))
}

describe('loadJudgedAgents（real DB）', () => {
  beforeEach(cleanup)
  afterAll(cleanup)

  it('影子報告的 judge 帳不算正式報告已評過', async () => {
    await getDb().insert(llmCalls).values(row(`${SHADOW_RUN_ID_PREFIX}judge-1`, 'brief-quality-judge'))
    expect(await loadJudgedAgents(DATE)).toEqual([])
  })

  it('正式報告的 judge 帳照常算已評過', async () => {
    await getDb().insert(llmCalls).values([row('gh-1-1', 'brief-quality-judge'), row(`${SHADOW_RUN_ID_PREFIX}judge-1`, 'brief-continuity-judge')])
    expect(await loadJudgedAgents(DATE)).toEqual(['brief-quality-judge'])
  })
})
