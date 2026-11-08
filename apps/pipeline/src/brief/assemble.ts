import type { CascadeChain, MarketBrief, MarketBriefCitation, RelatedNews, RelationType } from '@suanomics/shared'
import type { SynthesizerOutput } from '../agents/synthesizer.js'
import type { AnalystOutput } from '../agents/types.js'
import { MarketBriefDisclaimer } from '@suanomics/shared'
import { finalizeBriefSafety, makeInsufficientCitation } from './analyzer.js'

const MAX_CITATIONS = 20

// citation / relatedNews 的 url 只有 http(s) 才是可外開的真來源（同前端 isExternalUrl）。
export function isHttpUrl(s: string): boolean {
  try {
    const { protocol } = new URL(s)
    return protocol === 'http:' || protocol === 'https:'
  }
  catch {
    return false
  }
}

// brief.citations 由 analyst cascade citations（已 ground 到 retrieved 真 url）組裝：
// http(s) filter → 去重 → 按被幾條 chain 引用的頻率降序 → cap 20。空集回 sentinel。
export function assembleBriefCitations(analystOutputs: AnalystOutput[]): MarketBriefCitation[] {
  const byUrl = new Map<string, { title: string, quote: string, count: number }>()
  for (const a of analystOutputs) {
    for (const c of a.cascadeChains) {
      for (const cit of c.citations) {
        if (!isHttpUrl(cit.url))
          continue
        const existing = byUrl.get(cit.url)
        if (existing) {
          existing.count++
        }
        else {
          byUrl.set(cit.url, {
            title: cit.title.length > 0 ? cit.title : '來源',
            quote: cit.quote.length > 0 ? cit.quote.slice(0, 600) : '—',
            count: 1,
          })
        }
      }
    }
  }
  const sorted = [...byUrl.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, MAX_CITATIONS)
    .map(([url, v]) => ({ url, title: v.title, quote: v.quote }))
  if (sorted.length === 0)
    return [makeInsufficientCitation('此日無可佐證之外部來源連結')]
  return sorted
}

// cascade tree（前端 UI）的 citation 連結也要真 url：filter 非 http(s)。
// CascadeChainSchema.citations.url 維持寬鬆（analyst parse 在 fabrication-strip 前跑、不收緊）、
// 收口集中在這裡。
export function filterCascadeCitations(chains: CascadeChain[]): CascadeChain[] {
  return chains.map(c => ({ ...c, citations: c.citations.filter(cit => isHttpUrl(cit.url)) }))
}

export interface RelatedNewsRef {
  newsId: string
  relationType: RelationType
  reasoning: string
}

export interface AssembleDailyBriefParams {
  synth: SynthesizerOutput
  analystOutputs: AnalystOutput[]
  selectedNewsById: ReadonlyMap<string, { title: string, url: string }>
  cascadeChains: CascadeChain[]
  dailyThesis?: string
}

// 每日 brief 確定性組裝 gate（runDailyBrief Stage 4↔5 之間呼叫）：
// citations 由 analyst 源頭組裝、relatedNews by-id resolve、cascade filter、
// 再 sanitize→gate→clamp→MarketBriefSchema.parse（含 .url()）。
export function assembleDailyBrief(p: AssembleDailyBriefParams): MarketBrief {
  const assembled: MarketBrief = {
    headline: p.synth.headline,
    ...(p.dailyThesis !== undefined ? { dailyThesis: p.dailyThesis } : {}),
    summary: p.synth.summary,
    relatedNews: resolveRelatedNews(p.synth.relatedNews, p.selectedNewsById),
    affectedIndustries: p.synth.affectedIndustries,
    relatedETFs: p.synth.relatedETFs,
    reasoningChain: p.synth.reasoningChain,
    citations: assembleBriefCitations(p.analystOutputs),
    disclaimer: MarketBriefDisclaimer,
    cascadeChains: filterCascadeCitations(p.cascadeChains),
  }
  return finalizeBriefSafety(assembled)
}

// relatedNews 改由 Synthesizer 以 newsId 引用 selected news、這裡 id→真 {title,url} resolve。
// resolve 不到（LLM 捏 id）就 drop；同 id 去重；cap 5（對齊 RelatedNewsSchema array max）。
export function resolveRelatedNews(
  refs: RelatedNewsRef[],
  selectedNewsById: ReadonlyMap<string, { title: string, url: string }>,
): RelatedNews[] {
  const out: RelatedNews[] = []
  const seen = new Set<string>()
  for (const ref of refs) {
    if (seen.has(ref.newsId))
      continue
    const news = selectedNewsById.get(ref.newsId)
    if (!news || !isHttpUrl(news.url))
      continue
    seen.add(ref.newsId)
    out.push({ title: news.title, url: news.url, relationType: ref.relationType, reasoning: ref.reasoning })
    if (out.length >= 5)
      break
  }
  return out
}
