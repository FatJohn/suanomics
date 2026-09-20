import type { LlmProvider } from './resolve.js'

export interface ModelPrice { input: number, output: number } // per 1M tokens、USD

// 官方現價（Gemini 2026-08-23 實查 ai.google.dev/gemini-api/docs/pricing；
// claude-sonnet-4-6 為 2026-06-04 claude-api skill cache）。
// gemini-3.1-pro-preview 用 ≤200k tier（我們 prompt 遠低於 200k）。加新 model 補一筆。
export const MODEL_PRICING: Record<string, ModelPrice> = {
  'gemini-3.5-flash': { input: 1.50, output: 9.00 },
  // ★ 3.6 與 3.7 都在 introductory 折扣上，**2026-12-31 到期**、之後都是 1.50 / 7.50。
  // 到期日與到期後的價登記在下面的 PRICE_EXPIRY，由 pricing.test.ts 的 time-bomb 逼人更新。
  //
  // ★ 3.6 這筆 2026-08-23 更正過：原本記 1.50 / 7.50（那是它 2026-08-02 剛出時的價，
  // 也是當時 A/B 判它 NO-GO 時用的單價）。
  // Google 後來把它一起放進折扣。**過時的 entry 比缺 entry 更難發現**——缺的會 warn，
  // 過時的只會靜靜算出錯的成本，而那份 NO-GO 結論的成本前提也就跟著失效了。
  'gemini-3.6-flash': { input: 0.75, output: 3.75 },
  'gemini-3.7-flash': { input: 0.75, output: 3.75 },
  'gemini-3.5-flash-lite': { input: 0.30, output: 2.50 },
  'gemini-3.1-flash-lite': { input: 0.25, output: 1.50 },
  'gemini-3.1-pro-preview': { input: 2.00, output: 12.00 },
  'gemini-3-flash-preview': { input: 0.50, output: 3.00 },
  'claude-sonnet-4-6': { input: 3.00, output: 15.00 },
}

export const FALLBACK_PRICING: ModelPrice = { input: 1.50, output: 9.00 }

/**
 * 帶到期日的價格：introductory 折扣過了就不是這個數字。
 *
 * 靜態表沒辦法表達「某天之後換價」，而**過期的價格是安靜的**——成本報表照樣印得出數字、
 * 只是低估一半，`model:ab` 的 impliedPrice 反推還會把錯的價格當事實印出來。所以用
 * `pricing.test.ts` 的 time-bomb 逼人更新，而不是靠這行註解。
 */
export const PRICE_EXPIRY: Record<string, { expiresOn: string, after: ModelPrice }> = {
  'gemini-3.6-flash': { expiresOn: '2026-12-31', after: { input: 1.50, output: 7.50 } },
  'gemini-3.7-flash': { expiresOn: '2026-12-31', after: { input: 1.50, output: 7.50 } },
}

/** 距離某筆 introductory 價到期還有幾天（負數＝已過期）。 */
export function daysUntilPriceExpiry(model: string, now: Date): number | null {
  const e = PRICE_EXPIRY[model]
  if (!e)
    return null
  const end = new Date(`${e.expiresOn}T23:59:59Z`).getTime()
  return Math.floor((end - now.getTime()) / 86_400_000)
}

/** 到期前幾天開始讓守門測試變紅。 */
export const PRICE_FRESHNESS_MIN_DAYS = 7

const warnedModels = new Set<string>()
export function resetPricingWarnCache(): void {
  warnedModels.clear()
}

// 無價目表未知 model 的空頭 price（provider === 'openai' 時使用）。
// ★ 刻意記 0、不是猜一個「看起來合理」的估計：自架／OpenRouter 端點的價格我們
// 無從得知，捏一個像樣的數字比記 0 更危險——0 一眼看得出沒在算，捏造的數字不會。
// 這個 repo 的量測失敗模式正是「跑完了、數字合理、但是錯的」。
const ZERO_PRICING: ModelPrice = { input: 0, output: 0 }

export function priceFor(provider: LlmProvider, model: string): ModelPrice {
  const p = MODEL_PRICING[model]
  if (p)
    return p
  if (provider === 'openai') {
    if (!warnedModels.has(model)) {
      warnedModels.add(model)
      console.warn(`[pricing] no price entry for openai model ${model}, recording cost as $0 (self-hosted/OpenRouter pricing unknown — this is NOT actually free)`)
    }
    return ZERO_PRICING
  }
  // gemini / anthropic：作者自己在用的 provider，用保守估計價比記 0 更貼近實際帳單。
  if (!warnedModels.has(model)) {
    warnedModels.add(model)
    console.warn(`[pricing] no price entry for model ${model}, using fallback`)
  }
  return FALLBACK_PRICING
}

// cache rate multiplier（相對基準 input 價）。實作時對齊當期官方定價：
// Anthropic 5-min ephemeral：write 1.25x、read 0.1x。Gemini 隱式 cached：0.25x。
// OpenAI cached input：0.5x——但未知 model 的基準價已經是 0（見 ZERO_PRICING），
// 0 * 0.5 還是 0，這裡登記官方倍率只是保持語意完整、不影響現行零成本結果。
const CACHE_RATES = {
  anthropic: { write: 1.25, read: 0.1 },
  gemini: { cached: 0.25 },
  openai: { cached: 0.5 },
} as const

export interface CostBreakdown {
  tokensIn: number
  tokensOut: number
  cachedReadTokens?: number
  cacheWriteTokens?: number
}

// provider-aware 成本計算（USD）。token 帳務語意：
// - Anthropic：tokensIn 不含 cached → 直接加 write(1.25x) + read(0.1x)
// - Gemini / OpenAI：tokensIn 含 cached → regular = tokensIn - cachedRead，cached 算各自倍率
export function computeCost(provider: LlmProvider, model: string, b: CostBreakdown): number {
  const { input, output } = priceFor(provider, model)
  const cachedRead = b.cachedReadTokens ?? 0
  const cacheWrite = b.cacheWriteTokens ?? 0
  const inputUnits = provider === 'anthropic'
    ? b.tokensIn + cacheWrite * CACHE_RATES.anthropic.write + cachedRead * CACHE_RATES.anthropic.read
    : (b.tokensIn - cachedRead) + cachedRead * CACHE_RATES[provider].cached
  return (inputUnits * input + b.tokensOut * output) / 1_000_000
}
