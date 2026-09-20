import type { ContinuityCompareResult } from './continuity-judge.js'
import type { DimCompareResult } from './pairwise.js'

export interface ContinuityReportMeta {
  labelA: string
  labelB: string
  model: string
  tokensIn: number
  tokensOut: number
  costUsd: number
}

// 將維度結果轉為 markdown 段落，勝方映回 label
function renderDim(heading: string, dim: DimCompareResult, meta: ContinuityReportMeta): string[] {
  const winnerLabel = dim.winner === 'A' ? meta.labelA : dim.winner === 'B' ? meta.labelB : '相當'
  return [
    `## ${heading}：${winnerLabel}`,
    '',
    `- orientation 1 理由：${dim.reasons[0]}`,
    `- orientation 2 理由：${dim.reasons[1]}`,
  ]
}

export function buildContinuityReport(result: ContinuityCompareResult, meta: ContinuityReportMeta): string {
  const L: string[] = []
  L.push(`# Brief Continuity Compare：${meta.labelA} vs ${meta.labelB}`)
  L.push('')
  L.push('> 勝方 = 兩 orientation（位置對調）一致才判；不一致記「相當」。連續性相對「昨日報告」評。')
  L.push('')
  L.push(...renderDim('跨日連貫', result.crossDay, meta))
  L.push('')
  L.push(...renderDim('論點演進', result.thesisDelta, meta))
  L.push('')
  L.push(...renderDim('伏筆兌現', result.resolvePayoff, meta))
  L.push('')
  L.push('## meta')
  L.push('')
  L.push('| 欄位 | 值 |')
  L.push('| --- | --- |')
  L.push(`| A | ${meta.labelA} |`)
  L.push(`| B | ${meta.labelB} |`)
  L.push(`| judge model | ${meta.model} |`)
  L.push(`| judge tokensIn | ${meta.tokensIn} |`)
  L.push(`| judge tokensOut | ${meta.tokensOut} |`)
  L.push(`| judge costUsd | ${meta.costUsd.toFixed(4)} |`)
  return L.join('\n')
}
