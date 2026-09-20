import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ANALYST_TIER1_FANOUT_CONCURRENCY,
  checkLlmConcurrencyBudget,
  DECOMPOSER_FANOUT_CONCURRENCY,
  effectiveLlmPeak,
  MAX_SAFE_LLM_PEAK,
  resetLlmConcurrencyBudgetWarnCache,
  RETRIEVE_FANOUT_CONCURRENCY,
  TIER2_FANOUT_CONCURRENCY,
  warnLlmConcurrencyBudgetOnce,
} from './fanout-concurrency.js'

describe('effectiveLlmPeak', () => {
  it('是 max(decomposer, retrieve, tier1 * tier2)：三個 stage 循序、analyst 內部巢狀', () => {
    // decompose → retrieve → analyst 三個 stage 循序執行，全域尖峰不是四值相加；
    // analyst stage 內部才是巢狀：tier-1 worker 的 await callAnalystTier1() 完成後
    // 才進 tier-2 fanout，tier-1 與 tier-2 不同時在飛，所以 analyst stage 自己的尖峰
    // 是 tier1 * tier2（N 個 tier-1 worker 同時在飛，每個各自可能同時展開 tier2 個
    // tier-2 chain）。
    expect(effectiveLlmPeak({ decomposer: 3, retrieve: 3, tier1: 3, tier2: 3 })).toBe(9)
  })

  it('目前預設值算出來是 9', () => {
    expect(effectiveLlmPeak({
      decomposer: DECOMPOSER_FANOUT_CONCURRENCY,
      retrieve: RETRIEVE_FANOUT_CONCURRENCY,
      tier1: ANALYST_TIER1_FANOUT_CONCURRENCY,
      tier2: TIER2_FANOUT_CONCURRENCY,
    })).toBe(9)
  })

  it('tier1 * tier2 相乘：兩者任一放大，乘積跟著放大', () => {
    expect(effectiveLlmPeak({ decomposer: 1, retrieve: 1, tier1: 4, tier2: 3 })).toBe(12)
    expect(effectiveLlmPeak({ decomposer: 1, retrieve: 1, tier1: 3, tier2: 4 })).toBe(12)
  })

  it('decomposer / retrieve 只跟乘積取 max，不參與相乘', () => {
    expect(effectiveLlmPeak({ decomposer: 20, retrieve: 1, tier1: 3, tier2: 3 })).toBe(20)
    expect(effectiveLlmPeak({ decomposer: 1, retrieve: 20, tier1: 3, tier2: 3 })).toBe(20)
  })

  // ★ 守門測試：用目前實際生效的四個常數算尖峰，超過 MAX_SAFE_LLM_PEAK 就紅。
  // 這是防呆本體——有人把 ANALYST_TIER1_FANOUT_CONCURRENCY 或 TIER2_FANOUT_CONCURRENCY
  // 從 3 改成 4（9 → 12）會讓它紅；只改 fallback 常數不必動這個測試就能重現。
  it('目前實際生效的常數算出的尖峰必須 <= MAX_SAFE_LLM_PEAK（專案的 LLM 風險門檻）', () => {
    const peak = effectiveLlmPeak({
      decomposer: DECOMPOSER_FANOUT_CONCURRENCY,
      retrieve: RETRIEVE_FANOUT_CONCURRENCY,
      tier1: ANALYST_TIER1_FANOUT_CONCURRENCY,
      tier2: TIER2_FANOUT_CONCURRENCY,
    })
    expect(peak).toBeLessThanOrEqual(MAX_SAFE_LLM_PEAK)
  })
})

describe('checkLlmConcurrencyBudget', () => {
  it('尖峰在門檻內回傳 null（不吵）', () => {
    expect(checkLlmConcurrencyBudget({ decomposer: 3, retrieve: 3, tier1: 3, tier2: 3 })).toBeNull()
  })

  it('尖峰超過門檻回傳一行 [startup-config] 開頭的 DEGRADED 警告、含四個值/尖峰/門檻', () => {
    const line = checkLlmConcurrencyBudget({ decomposer: 3, retrieve: 3, tier1: 4, tier2: 3 })
    expect(line).not.toBeNull()
    expect(line?.level).toBe('error')
    expect(line?.message).toMatch(/^\[startup-config\]/)
    expect(line?.message).toContain('DEGRADED')
    expect(line?.message).toContain('12') // 算出的尖峰
    expect(line?.message).toContain(String(MAX_SAFE_LLM_PEAK))
    expect(line?.message).toContain('decomposer=3')
    expect(line?.message).toContain('retrieve=3')
    expect(line?.message).toContain('tier1=4')
    expect(line?.message).toContain('tier2=3')
    expect(line?.message).toContain('suspicious') // 為什麼重要：會被 provider 判定 suspicious activity
  })
})

describe('warnLlmConcurrencyBudgetOnce', () => {
  beforeEach(() => {
    resetLlmConcurrencyBudgetWarnCache()
  })

  const OVER = { decomposer: 3, retrieve: 3, tier1: 4, tier2: 3 } // peak=12 > 10
  const UNDER = { decomposer: 3, retrieve: 3, tier1: 3, tier2: 3 } // peak=9 <= 10

  it('超標時第一次呼叫印一次、第二次不印；reset 後可以再印一次', () => {
    const log = vi.fn()
    warnLlmConcurrencyBudgetOnce(OVER, log)
    expect(log).toHaveBeenCalledTimes(1)
    warnLlmConcurrencyBudgetOnce(OVER, log)
    expect(log).toHaveBeenCalledTimes(1) // 第二次不印

    resetLlmConcurrencyBudgetWarnCache()
    warnLlmConcurrencyBudgetOnce(OVER, log)
    expect(log).toHaveBeenCalledTimes(2) // reset 後再印
  })

  it('沒超標時不印（負向對照：無條件印會讓這條紅）', () => {
    const log = vi.fn()
    warnLlmConcurrencyBudgetOnce(UNDER, log)
    expect(log).not.toHaveBeenCalled()
  })

  it('沒超標的呼叫不佔用 once 名額：之後超標仍能印', () => {
    const log = vi.fn()
    warnLlmConcurrencyBudgetOnce(UNDER, log)
    warnLlmConcurrencyBudgetOnce(OVER, log)
    expect(log).toHaveBeenCalledTimes(1)
  })
})
