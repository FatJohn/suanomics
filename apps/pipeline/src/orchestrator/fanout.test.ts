import { describe, expect, it } from 'vitest'
import { DailyCostLimitExceededError } from '../agents/cost-gate.js'
import { effectiveLlmPeak, FANOUT, fanoutSettled } from './fanout.js'

describe('fanoutSettled', () => {
  it('單筆失敗不中斷整批，順序與輸入相同', async () => {
    const out = await fanoutSettled([1, 2, 3], 2, async (n) => {
      if (n === 2)
        throw new Error('x')
      return n * 10
    })
    expect(out.map(r => r.status)).toEqual(['fulfilled', 'rejected', 'fulfilled'])
    expect(out[0]).toEqual({ status: 'fulfilled', value: 10 })
  })

  it('花費閘錯誤要等在飛的工作收尾後才往外丟', async () => {
    let finished = 0
    await expect(fanoutSettled([1, 2], 2, async (n) => {
      if (n === 1)
        throw new DailyCostLimitExceededError(1, 2)
      await new Promise(r => setTimeout(r, 10))
      finished++
    })).rejects.toBeInstanceOf(DailyCostLimitExceededError)
    expect(finished).toBe(1)
  })

  it('同時在飛的工作不超過上限', async () => {
    let inFlight = 0
    let peak = 0
    await fanoutSettled([1, 2, 3, 4, 5], 2, async () => {
      peak = Math.max(peak, ++inFlight)
      await new Promise(r => setTimeout(r, 1))
      inFlight--
    })
    expect(peak).toBe(2)
  })
})

describe('並行預算', () => {
  it('有效尖峰不超過專案門檻 10', () => {
    expect(effectiveLlmPeak(FANOUT)).toBeLessThanOrEqual(10)
  })
})
