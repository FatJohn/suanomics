import type { LlmRunTerm } from './llm-run-budget.js'

// 搬自 llm-run-estimates.ts（純搬移、無行為變更）：llm-run-estimates.ts 與
// prompt-research-distill-estimate.ts 都要建構 LlmRunTerm，抽到共用檔避免互相 import
// 造成循環依賴。

/** callAgentLLM 預設 maxRetries=3，是多數 term 的 httpMultiplier。 */
export const DEFAULT_HTTP_MULTIPLIER = 3

export function term(label: string, units: number, callsPerUnit: number, httpMultiplier: number, basis: string): LlmRunTerm {
  return { label, units, callsPerUnit, httpMultiplier, basis }
}
