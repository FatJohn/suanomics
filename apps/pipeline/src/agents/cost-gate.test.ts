import { describe, expect, it } from 'vitest'
import { DailyCostGate, DailyCostLimitExceededError, parseDailyCostLimit } from './cost-gate.js'

describe('dailyCostGate', () => {
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
  })
})
