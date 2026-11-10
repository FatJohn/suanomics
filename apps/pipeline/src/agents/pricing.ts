export interface ModelPrice { input: number, output: number } // per 1M tokens、USD

// 來源：claude-api skill 的 Anthropic 官方價目快取，更新日 2026-10-06。
// 調價時同時改 PRICE_VERSION：帳本每筆存當時的版本，舊資料不重算。
export const PRICE_VERSION = '2026-10-06'

// Haiku 5.5 的 prompt 超過 100K token 時單價變 5 倍，表上只記 100K 以內的價；
// 高量層 agent 的輸入遠低於這個長度。
const MODEL_PRICING: Record<string, ModelPrice> = {
  'claude-haiku-5-5': { input: 0.10, output: 0.50 },
  'claude-sonnet-5-5': { input: 2.00, output: 10.00 },
}

// 相對基準 input 單價的倍率（5 分鐘 ephemeral）。
const CACHE_RATES = { write: 1.25, read: 0.1 }

// v0 對未知 model 用估計價並 warn；這裡的數字直接餵花費閘，低估會讓閘失效，所以拒絕。
export function priceFor(model: string): ModelPrice {
  const price = MODEL_PRICING[model]
  if (!price)
    throw new Error(`pricing 沒有這個 model 的價格：${model}`)
  return price
}

export interface TokenUsage {
  noCacheInputTokens: number
  cacheWriteTokens: number
  cacheReadTokens: number
  outputTokens: number
}

export function computeCost(model: string, usage: TokenUsage): number {
  const { input, output } = priceFor(model)
  const inputUnits = usage.noCacheInputTokens
    + usage.cacheWriteTokens * CACHE_RATES.write
    + usage.cacheReadTokens * CACHE_RATES.read
  return (inputUnits * input + usage.outputTokens * output) / 1_000_000
}
