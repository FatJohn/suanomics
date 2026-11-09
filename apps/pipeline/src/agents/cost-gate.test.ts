import type { LlmCallEntry, LlmLedger, LlmLedgerRow } from './cost-gate.js'
import { describe, expect, it, vi } from 'vitest'
import { CostGateError, DailyCostGate, DailyCostLimitExceededError, parseDailyCostLimit } from './cost-gate.js'

describe('dailyCostGate', () => {
  it('每次 record 累計呼叫數', () => {
    const gate = new DailyCostGate(1)
    gate.record(0.1)
    gate.record(0.2)
    expect(gate.callCount).toBe(2)
  })

  it('累計低於上限時通過', () => {
    const gate = new DailyCostGate(1)
    gate.record(0.99)
    expect(() => gate.assertWithinLimit()).not.toThrow()
  })

  it('累計剛好等於上限時仍通過（超過才拒絕）', () => {
    const gate = new DailyCostGate(1)
    gate.record(1)
    expect(() => gate.assertWithinLimit()).not.toThrow()
  })

  it('累計超過上限後拒絕，丟出特定錯誤並帶金額', () => {
    const gate = new DailyCostGate(1)
    gate.record(0.6)
    gate.record(0.41)
    expect(() => gate.assertWithinLimit()).toThrow(DailyCostLimitExceededError)
    try {
      gate.assertWithinLimit()
    }
    catch (e) {
      expect(e).toMatchObject({ limitUsd: 1, spentUsd: 1.01 })
    }
  })

  it('totalUsd 回報累計值', () => {
    const gate = new DailyCostGate(5)
    gate.record(1.5)
    gate.record(2)
    expect(gate.totalUsd).toBe(3.5)
  })
})

describe('parseDailyCostLimit', () => {
  it('接受正數', () => {
    expect(parseDailyCostLimit('2.5')).toBe(2.5)
  })

  it.each([undefined, '', 'abc', '0', '-1', 'Infinity'])('未設定或不是正數時拒絕：%s', (raw) => {
    expect(() => parseDailyCostLimit(raw)).toThrow(/DAILY_COST_LIMIT_USD/)
    expect(() => parseDailyCostLimit(raw)).toThrow(CostGateError)
  })
})

const ENTRY: LlmCallEntry = {
  agent: 'news-tagger',
  provider: 'anthropic',
  model: 'claude-haiku-5-5',
  tokensIn: 1,
  tokensOut: 1,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  latencyMs: 1,
  attempts: 1,
  status: 'ok',
  costUsd: 0.5,
  priceVersion: 'v',
}

function fakeLedger(): LlmLedger & { rows: LlmLedgerRow[] } {
  const rows: LlmLedgerRow[] = []
  return {
    rows,
    insert: async (row) => {
      rows.push(row)
    },
  }
}

describe('dailyCostGate 的 recordCall', () => {
  it('累計並寫一列，帶 runId 與 reportDate', async () => {
    const ledger = fakeLedger()
    const gate = new DailyCostGate(1, { ledger, runId: 'r1' })
    gate.setReportDate('2026-11-09')
    await gate.recordCall(ENTRY)
    expect(gate.totalUsd).toBe(0.5)
    expect(gate.callCount).toBe(1)
    expect(ledger.rows).toHaveLength(1)
    expect(ledger.rows[0]).toMatchObject({ ...ENTRY, runId: 'r1', reportDate: '2026-11-09' })
  })

  it('costUsd 為 null 時閘當 0 計、列照寫', async () => {
    const ledger = fakeLedger()
    const gate = new DailyCostGate(1, { ledger })
    await gate.recordCall({ ...ENTRY, costUsd: null, status: 'failed' })
    expect(gate.totalUsd).toBe(0)
    expect(gate.callCount).toBe(1)
    expect(ledger.rows[0]?.costUsd).toBeNull()
  })

  it('暫時失敗重試時沿用同一個 id，讓 DB 端能去重', async () => {
    const ids: string[] = []
    let fails = 2
    const gate = new DailyCostGate(1, {
      retryDelayMs: 0,
      ledger: {
        ...fakeLedger(),
        insert: async (row) => {
          ids.push(row.id)
          if (fails-- > 0)
            throw new Error('transient')
        },
      },
    })
    await gate.recordCall(ENTRY)
    expect(ids).toHaveLength(3)
    expect(new Set(ids).size).toBe(1)
  })

  it('重試用完仍寫不進去時不擋 run，但印 Actions annotation 與整列內容', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const gate = new DailyCostGate(1, {
      retryDelayMs: 0,
      ledger: {
        insert: async () => {
          throw new Error('db down')
        },
      },
    })
    await expect(gate.recordCall(ENTRY)).resolves.toBeUndefined()
    expect(gate.totalUsd).toBe(0.5)
    const output = error.mock.calls.map(c => String(c[0])).join('\n')
    expect(output).toContain('::error')
    expect(output).toContain('llm_ledger_write_failed')
    expect(output).toContain('claude-haiku-5-5')
    error.mockRestore()
  })

  it('每次呼叫的 id 不同', async () => {
    const ledger = fakeLedger()
    const gate = new DailyCostGate(1, { ledger })
    await gate.recordCall(ENTRY)
    await gate.recordCall(ENTRY)
    expect(ledger.rows[0]?.id).not.toBe(ledger.rows[1]?.id)
  })
})
