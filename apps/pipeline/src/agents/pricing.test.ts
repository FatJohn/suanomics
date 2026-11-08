import { describe, expect, it } from 'vitest'
import { computeCost, priceFor } from './pricing.js'

describe('priceFor', () => {
  it('預設 model 都有價格', () => {
    expect(priceFor('claude-haiku-5-5')).toEqual({ input: 0.10, output: 0.50 })
    expect(priceFor('claude-sonnet-5-5')).toEqual({ input: 2.00, output: 10.00 })
  })

  it('沒有價格的 model 直接拒絕，不用估計值讓花費閘少算', () => {
    expect(() => priceFor('claude-unpriced')).toThrow(/claude-unpriced/)
  })
})

describe('computeCost', () => {
  it('未快取全價、cache 寫入 1.25 倍、讀取 0.1 倍', () => {
    const cost = computeCost('claude-sonnet-5-5', {
      noCacheInputTokens: 1_000_000,
      cacheWriteTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
      outputTokens: 1_000_000,
    })
    expect(cost).toBeCloseTo(2 + 2.5 + 0.2 + 10, 10)
  })
})
