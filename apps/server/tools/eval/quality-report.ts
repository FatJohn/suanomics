import type { DimCompareResult } from './pairwise.js'
import type { QualityCompareResult } from './quality-judge.js'

export interface CompareReportMeta {
  labelA: string
  labelB: string
  model: string
  tokensIn: number
  tokensOut: number
  costUsd: number
  sourceCount: number
}

// 將維度結果轉為 markdown 段落，勝方映回 label
function renderDim(heading: string, dim: DimCompareResult, meta: CompareReportMeta): string[] {
  const winnerLabel = dim.winner === 'A' ? meta.labelA : dim.winner === 'B' ? meta.labelB : '相當'
  return [
    `## ${heading}：${winnerLabel}`,
    '',
    `- orientation 1 理由：${dim.reasons[0]}`,
    `- orientation 2 理由：${dim.reasons[1]}`,
  ]
}

export function buildCompareReport(result: QualityCompareResult, meta: CompareReportMeta): string {
  const L: string[] = []
  L.push(`# Brief Quality Compare：${meta.labelA} vs ${meta.labelB}`)
  L.push('')
  L.push('> 勝方 = 兩 orientation（位置對調）一致才判；不一致記「相當」。')
  L.push('')
  L.push(...renderDim('解讀深度', result.depth, meta))
  L.push('')
  L.push(...renderDim('可讀性', result.readability, meta))
  L.push('')
  L.push(...renderDim('可信度', result.grounding, meta))
  L.push('')
  L.push('## meta')
  L.push('')
  L.push('| 欄位 | 值 |')
  L.push('| --- | --- |')
  L.push(`| A | ${meta.labelA} |`)
  L.push(`| B | ${meta.labelB} |`)
  L.push(`| judge model | ${meta.model} |`)
  L.push(`| 事實底本新聞數 | ${meta.sourceCount} |`)
  L.push(`| judge tokensIn | ${meta.tokensIn} |`)
  L.push(`| judge tokensOut | ${meta.tokensOut} |`)
  L.push(`| judge costUsd | ${meta.costUsd.toFixed(4)} |`)
  return L.join('\n')
}
