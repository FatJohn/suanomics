// 集合重疊指標與單價反推。純算術、無 I/O。

export interface PairStat {
  refCount: number
  candCount: number
  inter: number
  recall: number
  precision: number
  jaccard: number
}

/** set 語意：同一個實體被抽兩次不該灌高分母。兩邊都空視為一致（1）而非 0/0。 */
export function pairStat(ref: readonly string[], cand: readonly string[]): PairStat {
  const r = new Set(ref)
  const c = new Set(cand)
  let inter = 0
  for (const x of c) {
    if (r.has(x))
      inter++
  }
  const union = new Set([...r, ...c]).size
  return {
    refCount: r.size,
    candCount: c.size,
    inter,
    recall: r.size ? inter / r.size : 1,
    precision: c.size ? inter / c.size : 1,
    jaccard: union ? inter / union : 1,
  }
}

export function mean(xs: readonly number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0
}

export function median(xs: readonly number[]): number {
  if (!xs.length)
    return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)] ?? 0
}

export function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`
}

/** Gemini prompt cache 命中的 input token 只收 25%。 */
export function billableInputUnits(call: { tokensIn: number, cachedReadTokens?: number }): number {
  const cached = call.cachedReadTokens ?? 0
  return (call.tokensIn - cached) + cached * 0.25
}

export interface PriceFit { input: number | null, output: number | null }

/**
 * 最小平方法從 (billable input units, tokensOut, costUsd) 反推 ($/1M input, $/1M output)。
 *
 * 為什麼要這個：`AGENT_MODELS` 設下去不代表 llm-wrapper 真的收了——resolve 失敗會靜靜
 * fallback。但帳算出來的單價騙不了人（定價表 flash=1.50/9.00、flash-lite=0.30/2.50），
 * 所以這是「兩臂真的跑在不同 model」的硬證據，每次跑都要印。
 *
 * 資料共線（每筆 in/out 比例都一樣）時 determinant 為 0、回 null 而不是硬掰一組數字。
 */
export function recoverPrices(
  rows: readonly { inUnits: number, out: number, cost: number }[],
): PriceFit {
  let sxx = 0
  let sxy = 0
  let syy = 0
  let sxc = 0
  let syc = 0
  for (const r of rows) {
    const c = r.cost * 1_000_000
    sxx += r.inUnits * r.inUnits
    sxy += r.inUnits * r.out
    syy += r.out * r.out
    sxc += r.inUnits * c
    syc += r.out * c
  }
  const det = sxx * syy - sxy * sxy
  // 尺度相依的絕對門檻在 token 量級（1e4~1e8）下會誤判、改用相對於 sxx*syy 的比例。
  if (!Number.isFinite(det) || Math.abs(det) < Math.abs(sxx * syy) * 1e-12 || sxx * syy === 0)
    return { input: null, output: null }
  return {
    input: (sxc * syy - syc * sxy) / det,
    output: (syc * sxx - sxc * sxy) / det,
  }
}
