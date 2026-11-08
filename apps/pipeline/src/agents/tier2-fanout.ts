import type { LlmCallRecord } from './call-agent.js'
import type { AliasMap } from './entity-aliases.js'
import type { CascadeChain } from './types.js'
import { FANOUT, fanoutSettled } from '../orchestrator/fanout.js'
import { callAnalystTier2 } from './analyst.js'
import { expandEntities, getDefaultAliasMap } from './entity-aliases.js'
import { retrieveArticles } from './retriever.js'

// tier 1 chains 蓋 chainId / tier / parentChainId、dedupe nextTierEntities vs affectedTickers
export function stampTier1(rawChains: CascadeChain[]): CascadeChain[] {
  return rawChains.map((c, idx) => {
    const dedupedEntities = c.nextTierEntities
      ? c.nextTierEntities.filter(e => !c.affectedTickers.includes(e))
      : undefined
    return {
      ...c,
      chainId: `t1-${idx}`,
      tier: 1 as const,
      parentChainId: undefined,
      ...(dedupedEntities && dedupedEntities.length > 0
        ? { nextTierEntities: dedupedEntities }
        : { nextTierEntities: undefined }),
    }
  })
}

export interface RunTier2FanoutParams {
  news: { title: string, text: string, id?: string }
  tier1Chains: CascadeChain[]
  /** 報告日：二階檢索窗的上界錨點，與一階同一個值。 */
  reportDate: string
  aliases?: AliasMap
  marketSnapshot?: string | null
  onCallRecord?: (r: LlmCallRecord) => void
}

type EligibleParent = CascadeChain & { chainId: string, nextTierEntities: string[] }

function isEligibleParent(c: CascadeChain): c is EligibleParent {
  return c.chainId !== undefined && (c.nextTierEntities?.length ?? 0) > 0
}

// 對 nextTierEntities 非空的 tier 1 chain 做 retrieve + tier 2 Analyst、蓋 chainId／parentChainId。
// retrieve 空或 Analyst 失敗都只少該 parent 的 chain；花費閘例外由 fanoutSettled 往外丟。
export async function runTier2Fanout(p: RunTier2FanoutParams): Promise<CascadeChain[]> {
  const aliasMap = p.aliases ?? getDefaultAliasMap()
  const parents = p.tier1Chains.filter(isEligibleParent)
  if (parents.length === 0)
    return []

  const settled = await fanoutSettled(parents, FANOUT.tier2, async (parent): Promise<CascadeChain[]> => {
    const retrieved = await retrieveArticles({ entities: expandEntities(parent.nextTierEntities, aliasMap), days: 7, reportDate: p.reportDate }).catch(() => [])
    if (retrieved.length === 0)
      return []
    const output = await callAnalystTier2({
      newsTitle: p.news.title,
      newsText: p.news.text,
      ...(p.news.id !== undefined ? { newsId: p.news.id } : {}),
      parentChain: { chainId: parent.chainId, industry: parent.industry, mechanism: parent.mechanism, nextTierEntities: parent.nextTierEntities },
      retrieved,
      ...(p.marketSnapshot !== undefined ? { marketSnapshot: p.marketSnapshot } : {}),
      ...(p.onCallRecord !== undefined ? { onCallRecord: p.onCallRecord } : {}),
    })
    return output.cascadeChains
  })

  const failed = settled.filter(r => r.status === 'rejected').length
  if (failed > 0)
    console.warn(`[tier2] ${failed} 次 Analyst 失敗（降級為少二階 chain）`)

  let t2Idx = 0
  return settled.flatMap((result, i) => {
    const parent = parents[i]
    if (result.status === 'rejected' || parent === undefined)
      return []
    return result.value.map(c => ({
      ...c,
      chainId: `t2-${t2Idx++}`,
      tier: 2 as const,
      parentChainId: parent.chainId,
      nextTierEntities: undefined,
      // tier2 沒有 fabrication 白名單兜底，無佐證的鏈不得與 tier1 平起平坐。
      ...(c.citations.length === 0 ? { speculative: true } : {}),
    }))
  })
}
