import { MAX_SAFE_LLM_CALLS_PER_RUN, MAX_SAFE_LLM_PEAK } from '../../../src/agents/fanout-concurrency.js'

/**
 * 一支批次腳本裡「一種呼叫來源」的估算項——例如 brief-rerun 的每個 replicate、
 * claim-yield-smoke 的每則新聞。多個 term 加總成 estimateTotalCalls。
 */
export interface LlmRunTerm {
  label: string
  /** 這個來源會跑幾次（例：--replicates、新聞則數、canary 日期數） */
  units: number
  /** 每個 unit 產生幾次「成功」呼叫（retry 不算，見 fanout-concurrency.ts 決策 4） */
  callsPerUnit: number
  /** HTTP 最壞值的乘數（含 retry 上限）；只影響報告的「HTTP 最壞值」欄，不影響門檻判定 */
  httpMultiplier: number
  /** 這個係數的依據，逐字落進報告——檔:行或函式名，供事後追查 */
  basis: string
}

export interface LlmRunEstimate {
  script: string
  terms: LlmRunTerm[]
  /** 這支腳本單一 process 內的尖峰並行（不是全域 fanout 尖峰，是這支腳本自己的） */
  peak: number
  peakBasis: string
  /** 射程說明：估算法本身的已知盲區，逐字印進報告（不要事後才用嘴巴補） */
  caveats: string[]
}

function assertNonNegativeInteger(n: number, label: string): void {
  if (!Number.isInteger(n) || n < 0)
    throw new Error(`${label} 必須是非負整數（收到：${n}）`)
}

/** 加總每個 term 的 units × callsPerUnit；units／callsPerUnit／peak 不合法就直接拋錯，不當 0 悄悄放行。 */
export function estimateTotalCalls(e: LlmRunEstimate): number {
  assertNonNegativeInteger(e.peak, 'peak')
  let total = 0
  for (const t of e.terms) {
    assertNonNegativeInteger(t.units, `${t.label}.units`)
    assertNonNegativeInteger(t.callsPerUnit, `${t.label}.callsPerUnit`)
    total += t.units * t.callsPerUnit
  }
  return total
}

function estimateHttpWorstCase(e: LlmRunEstimate): number {
  return e.terms.reduce((sum, t) => sum + t.units * t.callsPerUnit * t.httpMultiplier, 0)
}

export type LlmRunExceeded = 'calls' | 'peak'
export type LlmRunVerdict = 'within' | 'over-confirmed' | 'over-unconfirmed'

export interface LlmRunJudgement {
  verdict: LlmRunVerdict
  exceeded: LlmRunExceeded[]
}

/**
 * 判定：呼叫數是否 > MAX_SAFE_LLM_CALLS_PER_RUN、或尖峰是否 > MAX_SAFE_LLM_PEAK。
 * 兩者都用嚴格大於——邊界值（剛好等於門檻）算 within，這是決策 3 定的「取超過的邊界前一格」。
 */
export function judgeLlmRunBudget(e: LlmRunEstimate, opts: { confirmed: boolean }): LlmRunJudgement {
  const total = estimateTotalCalls(e)
  const exceeded: LlmRunExceeded[] = []
  if (total > MAX_SAFE_LLM_CALLS_PER_RUN)
    exceeded.push('calls')
  if (e.peak > MAX_SAFE_LLM_PEAK)
    exceeded.push('peak')
  if (exceeded.length === 0)
    return { verdict: 'within', exceeded }
  return { verdict: opts.confirmed ? 'over-confirmed' : 'over-unconfirmed', exceeded }
}

/**
 * 明細報告：逐項係數、總數、HTTP 最壞值、尖峰、兩個門檻、caveats、如何略過。全部走 stderr。
 *
 * @param e 要報告的估算結果（terms／peak／caveats）。
 * @param judgement judgeLlmRunBudget 的判定結果，決定要不要印「超出門檻」那一行。
 * @param narrowingHint 「縮小範圍」提示要引導使用者改哪個參數——不是每支腳本都有
 * `--limit／--dates／--replicates`（例如 news-backfill-tags.ts 沒有這些旗標，提示錯了反而
 * 誤導）。不給就維持預設字串逐字不變，這樣既有呼叫端與既有測試不用改。
 */
export function formatLlmRunBudgetReport(e: LlmRunEstimate, judgement: LlmRunJudgement, narrowingHint?: string): string {
  const total = estimateTotalCalls(e)
  const httpWorst = estimateHttpWorstCase(e)
  const lines: string[] = [`[llm-run-budget] ${e.script}`]
  for (const t of e.terms)
    lines.push(`  - ${t.label}：${t.units} × ${t.callsPerUnit} = ${t.units * t.callsPerUnit} 次（依據：${t.basis}）`)
  lines.push(`  總計：${total} 次成功呼叫（HTTP 最壞值 ${httpWorst} 次，含 retry）`)
  lines.push(`  尖峰並行：${e.peak}（依據：${e.peakBasis}）`)
  lines.push(`  門檻：呼叫數 > ${MAX_SAFE_LLM_CALLS_PER_RUN} 或 尖峰 > ${MAX_SAFE_LLM_PEAK}`)
  if (e.caveats.length > 0) {
    lines.push('  caveats：')
    for (const c of e.caveats)
      lines.push(`    - ${c}`)
  }
  if (judgement.exceeded.length > 0)
    lines.push(`  超出門檻（${judgement.exceeded.join(', ')}）。加 --yes 略過，或用 ${narrowingHint ?? '--limit／--dates／--replicates'} 縮小範圍。`)
  return lines.join('\n')
}

/** `--yes`：只認完全等於這個字串，不接受 `--yesterday` 這類前綴相符的旗標。 */
export function hasYesFlag(argv: readonly string[]): boolean {
  return argv.includes('--yes')
}

export interface EnforceLlmRunBudgetOpts {
  confirmed: boolean
  errLog: (line: string) => void
  exit: (code: number) => void
  /** 見 formatLlmRunBudgetReport 的同名參數；不給就維持預設字串。 */
  narrowingHint?: string
}

/**
 * 批次腳本開跑前的把關：within 印一行摘要放行；over-confirmed 印明細後照跑；
 * over-unconfirmed 印明細後 exit(3)。全部走 errLog（stderr）——model-ab 的 stdout 是報表，
 * 混進去會污染報表輸出。
 */
export function enforceLlmRunBudget(e: LlmRunEstimate, opts: EnforceLlmRunBudgetOpts): void {
  const judgement = judgeLlmRunBudget(e, { confirmed: opts.confirmed })
  if (judgement.verdict === 'within') {
    opts.errLog(`[llm-run-budget] ${e.script}：預估 ${estimateTotalCalls(e)} 次呼叫、尖峰 ${e.peak}，在門檻內（${MAX_SAFE_LLM_CALLS_PER_RUN} / ${MAX_SAFE_LLM_PEAK}）。`)
    return
  }
  opts.errLog(formatLlmRunBudgetReport(e, judgement, opts.narrowingHint))
  if (judgement.verdict === 'over-unconfirmed')
    opts.exit(3)
}
