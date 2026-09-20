import { afterEach, describe, expect, it, vi } from 'vitest'
import { computeCost, daysUntilPriceExpiry, MODEL_PRICING, PRICE_EXPIRY, PRICE_FRESHNESS_MIN_DAYS, priceFor, resetPricingWarnCache } from './pricing.js'

afterEach(() => {
  vi.restoreAllMocks()
  resetPricingWarnCache()
})

describe('computeCost', () => {
  it('anthropic 無 cache = 基本公式', () => {
    // (1000*3 + 500*15)/1e6 = 0.0105
    expect(computeCost('anthropic', 'claude-sonnet-4-6', { tokensIn: 1000, tokensOut: 500 }))
      .toBeCloseTo(0.0105, 10)
  })
  it('anthropic 含 cache：write 1.25x、read 0.1x、tokensIn 不含 cached', () => {
    // input units = 100*1 + 20*1.25 + 900*0.1 = 215 → (215*3 + 500*15)/1e6
    const expected = (215 * 3 + 500 * 15) / 1e6
    expect(computeCost('anthropic', 'claude-sonnet-4-6', {
      tokensIn: 100,
      tokensOut: 500,
      cachedReadTokens: 900,
      cacheWriteTokens: 20,
    })).toBeCloseTo(expected, 10)
  })
  it('gemini 無 cache = 基本公式', () => {
    // (1000*1.5 + 500*9)/1e6 = 0.006
    expect(computeCost('gemini', 'gemini-3.5-flash', { tokensIn: 1000, tokensOut: 500 }))
      .toBeCloseTo(0.006, 10)
  })
  it('gemini 含 cache：cached 0.25x、tokensIn 含 cached 要相減', () => {
    // regular = 1000-800 = 200 → input units = 200*1 + 800*0.25 = 400 → (400*1.5 + 500*9)/1e6
    const expected = (400 * 1.5 + 500 * 9) / 1e6
    expect(computeCost('gemini', 'gemini-3.5-flash', {
      tokensIn: 1000,
      tokensOut: 500,
      cachedReadTokens: 800,
    })).toBeCloseTo(expected, 10)
  })
  it('openai 未知 model：零價 → 成本永遠是 0（不管 token 數與 cache）', () => {
    expect(computeCost('openai', 'llama-3.3-70b', {
      tokensIn: 1_000_000,
      tokensOut: 1_000_000,
      cachedReadTokens: 500_000,
    })).toBe(0)
  })
})

describe('priceFor', () => {
  it('returns exact price for known models', () => {
    expect(priceFor('gemini', 'gemini-3.5-flash')).toEqual({ input: 1.50, output: 9.00 })
    expect(priceFor('gemini', 'gemini-3.1-pro-preview')).toEqual({ input: 2.00, output: 12.00 })
    expect(priceFor('gemini', 'gemini-3-flash-preview')).toEqual({ input: 0.50, output: 3.00 })
    expect(priceFor('anthropic', 'claude-sonnet-4-6')).toEqual({ input: 3.00, output: 15.00 })
  })
  it('新分層 model 有價（2026-08-23 官方定價複查）', () => {
    // 3.6 在 2026-08-02 是 1.50 / 7.50，之後被 Google 一起放進 introductory 折扣。
    expect(priceFor('gemini', 'gemini-3.6-flash')).toEqual({ input: 0.75, output: 3.75 })
    expect(priceFor('gemini', 'gemini-3.5-flash-lite')).toEqual({ input: 0.30, output: 2.50 })
    expect(priceFor('gemini', 'gemini-3.1-flash-lite')).toEqual({ input: 0.25, output: 1.50 })
  })
  it('flash-lite 沒有落入 fallback（否則成本會被高估 5 倍）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    priceFor('gemini', 'gemini-3.5-flash-lite')
    expect(warn).not.toHaveBeenCalled()
  })
  it('falls back + warns once for unknown model', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(priceFor('gemini', 'made-up-model')).toEqual({ input: 1.50, output: 9.00 })
    expect(priceFor('gemini', 'made-up-model')).toEqual({ input: 1.50, output: 9.00 })
    expect(warn).toHaveBeenCalledTimes(1) // 每 model 只 warn 一次
  })
  // openai（自架／OpenRouter）沒有已知價目表可猜，記 0 比記一個捏造的估計價更安全——
  // 0 一眼看得出沒在算，捏造的數字看起來合理但是錯的（這個 repo 的量測失敗模式）。
  it('openai 未知 model → 0 價（不落 FALLBACK_PRICING）並 warn once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(priceFor('openai', 'llama-3.3-70b')).toEqual({ input: 0, output: 0 })
    expect(priceFor('openai', 'llama-3.3-70b')).toEqual({ input: 0, output: 0 })
    expect(warn).toHaveBeenCalledTimes(1)
  })
})

// 2026-08-23：`gemini-3.7-flash` 用的是 introductory 價（2026-12-31 到期）。
// 靜態價格表最危險的失效方式是**安靜過期**——報表照印、只是低估一半，而 model-ab 的
// impliedPrice 會把錯價當事實反推出來。所以讓它在到期前自己變紅。
describe('introductory 價的 time-bomb 守門', () => {
  it('3.6 與 3.7 現在用的都是折扣價，且各自登記了到期後的價格', () => {
    for (const m of ['gemini-3.6-flash', 'gemini-3.7-flash']) {
      expect(priceFor('gemini', m), m).toEqual({ input: 0.75, output: 3.75 })
      expect(PRICE_EXPIRY[m]?.after, m).toEqual({ input: 1.50, output: 7.50 })
    }
  })

  it('★ 每一筆折扣價都要登記到期日（漏登記＝到期後靜靜用錯價，不會 warn）', () => {
    for (const [model, p] of Object.entries(MODEL_PRICING)) {
      if (p.input === 0.75 && p.output === 3.75)
        expect(PRICE_EXPIRY[model], `${model} 是折扣價卻沒登記到期日`).toBeDefined()
    }
  })

  it('mock 今天在到期前 6 天 → 低於門檻（守門條件本身有鑑別力）', () => {
    const end = new Date('2026-12-31T23:59:59Z')
    expect(daysUntilPriceExpiry('gemini-3.7-flash', new Date(end.getTime() - 6 * 86_400_000)))
      .toBeLessThan(PRICE_FRESHNESS_MIN_DAYS)
  })

  it('mock 今天在到期前 8 天 → 高於門檻', () => {
    const end = new Date('2026-12-31T23:59:59Z')
    expect(daysUntilPriceExpiry('gemini-3.7-flash', new Date(end.getTime() - 8 * 86_400_000)))
      .toBeGreaterThanOrEqual(PRICE_FRESHNESS_MIN_DAYS)
  })

  it('★ 這條會在 2026-12-25 前後自己變紅：到期就把價格換成 PRICE_EXPIRY.after 並移除該筆登記', () => {
    for (const model of Object.keys(PRICE_EXPIRY)) {
      const left = daysUntilPriceExpiry(model, new Date())
      expect(left, `${model} 的 introductory 價剩 ${left} 天（或已過期）——去 pricing.ts 換成到期後的價格`)
        .toBeGreaterThanOrEqual(PRICE_FRESHNESS_MIN_DAYS)
    }
  })

  it('沒有登記到期日的 model 回 null（不是 0，免得被當成今天到期）', () => {
    expect(daysUntilPriceExpiry('gemini-3.5-flash', new Date())).toBeNull()
  })
})
