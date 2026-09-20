import type { CallRow, RunFile } from './types.js'
import { parseLabel } from './arms.js'
import { billableInputUnits, mean, median, recoverPrices } from './metrics.js'

// 單臂彙總：這一跑自己長什麼樣（不涉及兩臂比較、那在 pair-compare.ts）。

const VALID_KINDS = new Set(['company', 'ticker', 'sector', 'macro', 'other'])
/** entity-summary prompt 寫的 contentSummary 規格；schema 沒把關、所以在這裡量出界率。 */
const SUMMARY_MIN = 80
const SUMMARY_MAX = 120

export interface ArmSummary {
  label: string
  arm: string
  replicate: number
  configuredModel: string
  resolvedModel: string
  n: number
  failed: number
  entitiesPerArticle: number
  entitiesMedian: number
  otherRatio: number
  invalidKindCount: number
  tagsPerArticle: number
  summaryLenMean: number
  summaryLenMin: number
  summaryLenMax: number
  summaryOutOfRange: number
  zodFailures: number
  llmErrors: number
  retriedArticles: number
  tokensIn: number
  tokensOut: number
  costUsd: number
  latencyMeanMs: number
  latencyP95Ms: number
  impliedInputPrice: number | null
  impliedOutputPrice: number | null
}

/** 記帳優先吃呼叫層的 calls；沒有時退回 articles 的逐篇欄位。 */
function callRows(run: RunFile): CallRow[] {
  return run.calls ?? run.articles.map(a => ({
    tokensIn: a.tokensIn,
    tokensOut: a.tokensOut,
    cachedReadTokens: a.cachedReadTokens,
    costUsd: a.costUsd,
    latencyMs: a.latencyMs,
    attempts: a.attempts,
  }))
}

export function summarizeArm(run: RunFile): ArmSummary {
  const { arm, replicate } = parseLabel(run.label)
  const ok = run.articles.filter(a => !a.failed)
  const counts = ok.map(a => a.entities.length)
  const kinds = ok.flatMap(a => a.entities.map(e => e.kind))
  const rawKinds = ok.flatMap(a => a.rawKinds)
  const lens = ok.map(a => [...a.contentSummary].length)
  const calls = callRows(run)
  const lat = calls.map(c => c.latencyMs).sort((a, b) => a - b)
  const prices = recoverPrices(
    calls
      .filter(c => c.tokensOut > 0)
      .map(c => ({ inUnits: billableInputUnits(c), out: c.tokensOut, cost: c.costUsd })),
  )
  return {
    label: run.label,
    arm,
    replicate,
    configuredModel: run.configuredModel,
    resolvedModel: run.resolvedModel,
    n: run.articles.length,
    failed: run.articles.filter(a => a.failed).length,
    entitiesPerArticle: mean(counts),
    entitiesMedian: median(counts),
    otherRatio: kinds.length ? kinds.filter(k => k === 'other').length / kinds.length : 0,
    invalidKindCount: rawKinds.filter(k => !VALID_KINDS.has(k)).length,
    tagsPerArticle: mean(ok.map(a => a.topicTags.length)),
    summaryLenMean: mean(lens),
    summaryLenMin: lens.length ? Math.min(...lens) : 0,
    summaryLenMax: lens.length ? Math.max(...lens) : 0,
    summaryOutOfRange: lens.filter(l => l < SUMMARY_MIN || l > SUMMARY_MAX).length,
    zodFailures: run.articles.reduce((s, a) => s + a.zodFailures, 0),
    llmErrors: run.articles.reduce((s, a) => s + a.llmErrors, 0),
    retriedArticles: run.articles.filter(a => a.attempts > 1).length,
    tokensIn: calls.reduce((s, c) => s + c.tokensIn, 0),
    tokensOut: calls.reduce((s, c) => s + c.tokensOut, 0),
    costUsd: calls.reduce((s, c) => s + c.costUsd, 0),
    latencyMeanMs: mean(lat),
    latencyP95Ms: lat[Math.floor(lat.length * 0.95)] ?? 0,
    impliedInputPrice: prices.input,
    impliedOutputPrice: prices.output,
  }
}
