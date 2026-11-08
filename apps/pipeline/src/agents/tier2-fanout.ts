import type { AliasMap } from './entity-aliases.js'
import type { LlmCallRecord } from './llm-wrapper.js'
import type { CascadeChain } from './types.js'
import { pMap } from '../_p-map.js'
import { callAnalystTier2 } from './analyst.js'
import { expandEntities, getDefaultAliasMap } from './entity-aliases.js'
import { TIER2_FANOUT_CONCURRENCY } from './fanout-concurrency.js'
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
  onCallRecord: (r: LlmCallRecord) => void
}

// 對 nextTierEntities 非空的 tier 1 chain 並行做 retrieve + tier 2 Analyst pass、
// 蓋 chainId / parentChainId、graceful degrade（retrieve 空 / Analyst fail 各別吞）
export async function runTier2Fanout(p: RunTier2FanoutParams): Promise<CascadeChain[]> {
  // 契約：tier1Chains 必須先過 stampTier1（蓋 chainId）。沒蓋的若有 nextTierEntities
  // 會被 silently 跳過、log warn 讓 caller bug 浮上來而非吃掉。
  for (const c of p.tier1Chains) {
    if (c.nextTierEntities && c.nextTierEntities.length > 0 && c.chainId === undefined)
      console.warn('[orchestrator] tier 1 chain missing chainId — was stampTier1 called?', c.industry)
  }
  const aliasMap = p.aliases ?? getDefaultAliasMap()
  const eligibleParents = p.tier1Chains.filter(
    c => c.nextTierEntities && c.nextTierEntities.length > 0 && c.chainId !== undefined,
  )
  if (eligibleParents.length === 0)
    return []

  // bounded concurrency：避免撞 Gemini rate limit / DB connection pool
  // review 意見補上的修正。每個 worker 仍 try/catch 包好、不影響其他 parent。
  interface ParentResult { parent: CascadeChain, chains: CascadeChain[], failed: boolean }
  const tier2Results: ParentResult[] = await pMap(eligibleParents, TIER2_FANOUT_CONCURRENCY, async (parent) => {
    try {
      // eslint-disable-next-line ts/no-non-null-assertion -- nextTierEntities && chainId presence guaranteed by eligibleParents filter above
      const expanded = expandEntities(parent.nextTierEntities!, aliasMap)
      const retrieved = await retrieveArticles({ entities: expanded, days: 7, reportDate: p.reportDate }).catch(() => [])
      if (retrieved.length === 0)
        return { parent, chains: [], failed: false }
      const a2 = await callAnalystTier2({
        newsTitle: p.news.title,
        newsText: p.news.text,
        ...(p.news.id !== undefined ? { newsId: p.news.id } : {}),
        parentChain: {
          // eslint-disable-next-line ts/no-non-null-assertion -- chainId !== undefined guaranteed by eligibleParents filter above
          chainId: parent.chainId!,
          industry: parent.industry,
          mechanism: parent.mechanism,
          // eslint-disable-next-line ts/no-non-null-assertion -- nextTierEntities presence guaranteed by eligibleParents filter above
          nextTierEntities: parent.nextTierEntities!,
        },
        retrieved,
        ...(p.marketSnapshot !== undefined ? { marketSnapshot: p.marketSnapshot } : {}),
        onCallRecord: p.onCallRecord,
      })
      return { parent, chains: a2.cascadeChains, failed: false }
    }
    catch {
      return { parent, chains: [], failed: true }
    }
  })

  // 觀測 graceful degrade：tier 2 Analyst 失敗的 parent 不貢獻 chain、log warn
  // 對齊 [analyst-tier1] / [analyst-tier2] log pattern、prod 才有訊號可看
  const rejectedCount = tier2Results.filter(r => r.failed).length
  if (rejectedCount > 0)
    console.warn('[orchestrator] %d tier-2 Analyst call(s) failed (graceful degrade)', rejectedCount)

  let t2Idx = 0
  return tier2Results.flatMap(r => r.chains.map(c => ({
    ...c,
    chainId: `t2-${t2Idx++}`,
    tier: 2 as const,
    // eslint-disable-next-line ts/no-non-null-assertion -- chainId !== undefined guaranteed by eligibleParents filter above
    parentChainId: r.parent.chainId!,
    // 防禦：tier 2 chains 強制 nextTierEntities = undefined（即使 Gemini schema 已禁、
    // 萬一 normalizer 沒 strip 也補一刀）
    nextTierEntities: undefined,
    // 無 citation 的二階推演標 speculative（程式判定、非 LLM）：tier2 沒有 fabrication
    // detection 的 retrieve 白名單兜底、無佐證的鏈不得與 tier1 平起平坐
    ...(c.citations.length === 0 ? { speculative: true } : {}),
  })))
}
