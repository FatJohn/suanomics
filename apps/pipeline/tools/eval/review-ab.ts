import type { MarketBrief } from '@suanomics/shared'
import type { NarrativeReviewMaterial } from '../../src/agents/narrative-review.js'
import type { BriefRunInputs } from '../../src/orchestrator/daily.js'
import { buildMarketCloseFraming } from '../../src/agents/market-close-framing.js'
import { buildMarketClosureBlock } from '../../src/agents/market-closure.js'

/**
 * 從正式報告與它的 run_inputs 還原當天 narrative-writer 拿到的素材（#125 比較用）。
 * 新聞只留 decomposer 篩過、進了報告的那幾則（brief.newsTitlesById），與 run-brief 的 survived 一致。
 */
export function reviewMaterialFromStored(date: string, brief: MarketBrief, inputs: BriefRunInputs): NarrativeReviewMaterial {
  const kept = brief.newsTitlesById
  const news = inputs.editor.news
    .filter(n => kept === undefined || String(n.id) in kept)
    .map(n => ({ ...n, id: String(n.id) }))
  const mainThemes = inputs.editor.selection?.mainThemes
  return {
    briefDate: date,
    brief,
    news,
    claimLedger: brief.claimLedger ?? [],
    ...(mainThemes ? { mainThemes } : {}),
    marketCloseFraming: buildMarketCloseFraming(inputs.market.taiexCloseDate, date),
    marketSnapshot: inputs.market.snapshotBlock,
    calendarBlock: inputs.market.calendarBlock,
    officialBlock: inputs.market.officialBlock,
    storylineBlock: inputs.editor.storylineBlock,
    closureBlock: buildMarketClosureBlock(date),
  }
}
