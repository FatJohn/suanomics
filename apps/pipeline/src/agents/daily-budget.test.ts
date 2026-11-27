import { describe, expect, it, vi } from 'vitest'
import { DailyCostLimitExceededError } from './cost-gate.js'
import { createSharedDailyCostGate, sharedCostLimit } from './daily-budget.js'

describe('sharedCostLimit', () => {
  it('今天還剩的額度比本步上限多時，用本步上限', () => {
    expect(sharedCostLimit({ stepLimitUsd: 0.4, dailyTotalUsd: 3, spentTodayUsd: 1 })).toBeCloseTo(0.4)
  })

  it('前面步驟花掉的額度扣到本步：剩的比本步上限少時，用剩的', () => {
    expect(sharedCostLimit({ stepLimitUsd: 0.4, dailyTotalUsd: 3, spentTodayUsd: 2.75 })).toBeCloseTo(0.25)
  })

  it('今天已花到或超過每日總上限時，額度為 0 或負數', () => {
    expect(sharedCostLimit({ stepLimitUsd: 0.4, dailyTotalUsd: 3, spentTodayUsd: 3 })).toBe(0)
    expect(sharedCostLimit({ stepLimitUsd: 0.4, dailyTotalUsd: 3, spentTodayUsd: 3.2 })).toBeLessThan(0)
  })
})

describe('createSharedDailyCostGate', () => {
  it('三步依序跑到各自上限時，當日總花費不超過每日總上限', async () => {
    const steps = [0.5, 2.6, 0.4]
    let spent = 0
    for (const stepLimitUsd of steps) {
      const gate = await createSharedDailyCostGate({ stepLimitUsd, totalLimitRaw: '3.00', getSpentTodayUsd: async () => spent })
      // 只在呼叫前檢查：每次呼叫 0.01，直到閘拒絕。
      while (true) {
        try {
          gate.assertWithinLimit()
        }
        catch (error) {
          expect(error).toBeInstanceOf(DailyCostLimitExceededError)
          break
        }
        gate.record(0.01)
        spent += 0.01
      }
    }
    // 閘只在呼叫前檢查，最後一次呼叫會越過上限；每步最多多一次呼叫。
    expect(spent).toBeLessThanOrEqual(3 + steps.length * 0.01 + 1e-9)
  })

  it('前面步驟花掉的額度讓後面步驟提早被擋', async () => {
    const gate = await createSharedDailyCostGate({ stepLimitUsd: 0.4, totalLimitRaw: '3', getSpentTodayUsd: async () => 2.8 })
    gate.record(0.21)
    expect(() => gate.assertWithinLimit()).toThrow(DailyCostLimitExceededError)
  })

  it('額度用完時建閘不拋錯（不需要 LLM 的略過路徑照常 exit 0），第一次呼叫前才拒絕', async () => {
    for (const spent of [3, 3.2]) {
      const gate = await createSharedDailyCostGate({ stepLimitUsd: 0.4, totalLimitRaw: '3', getSpentTodayUsd: async () => spent })
      expect(() => gate.assertWithinLimit()).toThrow(DailyCostLimitExceededError)
    }
  })

  it('每日總上限沒設或不是正數時拒絕執行，不查帳本', async () => {
    const getSpentTodayUsd = vi.fn(async () => 0)
    for (const raw of [undefined, '', '0', 'abc'])
      await expect(createSharedDailyCostGate({ stepLimitUsd: 1, totalLimitRaw: raw, getSpentTodayUsd })).rejects.toThrow(/DAILY_TOTAL_COST_LIMIT_USD/)
    expect(getSpentTodayUsd).not.toHaveBeenCalled()
  })
})
