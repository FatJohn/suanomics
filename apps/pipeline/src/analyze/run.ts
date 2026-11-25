import type { AnalystOutput } from '../agents/types.js'
import { callAnalystTier1 } from '../agents/analyst.js'
import { callDecomposer } from '../agents/decomposer.js'
import { retrieveForDecomposed } from '../agents/retrieve-for-decomposed.js'
import { runTier2Fanout, stampTier1 } from '../agents/tier2-fanout.js'
import { filterCascadeCitations } from '../brief/assemble.js'

export interface SingleNewsInput {
  title: string
  text: string
  url?: string
}

/**
 * 日報 analyzeNews 的單則版：decomposer → 檢索 → tier1 → tier2。
 * 不帶市場快照與 claims 序列，那些要讀當日行情，單篇分析不需要。
 */
export async function analyzeSingleNews(input: SingleNewsInput, date: string): Promise<AnalystOutput> {
  const decomposed = await callDecomposer({ newsTitle: input.title, newsText: input.text })
  const retrieved = await retrieveForDecomposed(decomposed, date)
  const tier1 = await callAnalystTier1({
    newsTitle: input.title,
    newsText: input.text,
    ...(input.url !== undefined ? { newsUrl: input.url } : {}),
    briefDate: date,
    decomposed,
    retrieved,
  })
  const tier1Chains = stampTier1(tier1.cascadeChains)
  const tier2Chains = await runTier2Fanout({ news: { title: input.title, text: input.text }, tier1Chains, reportDate: date })
  return { ...tier1, cascadeChains: filterCascadeCitations([...tier1Chains, ...tier2Chains]) }
}
