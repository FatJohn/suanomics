import type { MarketBrief } from '@suanomics/shared'
import { MarketBriefSchema } from '@suanomics/shared'
import { redactBlockedMarkdown, redactBlockedSentences } from './compliance'

export interface CitationLink { title: string, url: string }
export interface NewsLink { id: number, title: string }
export type IndustryView = Pick<MarketBrief['affectedIndustries'][number], 'name' | 'direction' | 'confidence' | 'reasoning'> & { citations: CitationLink[] }

// section：讀者看到的「詳解 N」序號；'overall'＝整體性論點；null＝舊報告沒有參照，不標。
export interface ViewpointView { text: string, section: number | 'overall' | null }

export interface BriefView {
  date: string
  headline: string
  dailyThesis: string
  summary: string
  narrative: {
    intro: string
    sections: { heading: string, takeaway: string, body: string, citations: CitationLink[] }[]
    outro: string
  } | null
  viewpoints: { supportPoints: ViewpointView[], riskPoints: ViewpointView[], netRead: string } | null
  industries: IndustryView[]
  selectedNews: NewsLink[]
  citations: CitationLink[]
  disclaimer: string
}

export const WITHHELD_NEWS_TITLE = '（此標題依合規規則不顯示）'

// zod 的 .url() 接受 javascript: 這類 scheme，寫進 href 前要再擋一次。
export function safeHttpUrl(url: string): string | null {
  try {
    const { protocol } = new URL(url)
    return protocol === 'http:' || protocol === 'https:' ? url : null
  }
  catch {
    return null
  }
}

// 不合 schema 就讓 build 失敗：線上維持前一版，不發佈未驗證的內容。
export function parseBriefJson(date: string, json: unknown): MarketBrief {
  const parsed = MarketBriefSchema.safeParse(json)
  if (!parsed.success)
    throw new Error(`${date} 的 brief_json 不符合 MarketBriefSchema：${parsed.error.message}`)
  return parsed.data
}

// 只帶標題與連結、不帶 quote：部分來源的條款只允許網站引用標題與連結（docs/sources.md）。
function citationLinks(brief: MarketBrief): CitationLink[] {
  return brief.citations.flatMap((c) => {
    const url = safeHttpUrl(c.url)
    return url ? [{ title: redactBlockedSentences(c.title) || new URL(url).hostname, url }] : []
  })
}

function presentNarrative(brief: MarketBrief, citations: CitationLink[]): BriefView['narrative'] {
  if (!brief.narrative)
    return null
  const byUrl = new Map(citations.map(c => [c.url, c]))
  return {
    intro: redactBlockedMarkdown(brief.narrative.intro),
    sections: brief.narrative.sections.flatMap((s) => {
      const body = redactBlockedMarkdown(s.body)
      if (!body)
        return []
      return [{
        heading: redactBlockedSentences(s.heading),
        takeaway: redactBlockedSentences(s.takeaway ?? ''),
        body,
        citations: s.citationUrls.flatMap((u) => {
          const c = byUrl.get(u)
          return c ? [c] : []
        }),
      }]
    }),
    outro: redactBlockedMarkdown(brief.narrative.outro),
  }
}

// 原始段落號（1 起算）→ 讀者看到的序號。本文整段被攔截的段落不輸出（presentNarrative），
// 後面的段落序號會往前補，參照要跟著換，否則「見詳解 3」會跳到別段。
function displayedSectionNumbers(brief: MarketBrief): Map<number, number> {
  const map = new Map<number, number>()
  brief.narrative?.sections.forEach((s, i) => {
    if (redactBlockedMarkdown(s.body))
      map.set(i + 1, map.size + 1)
  })
  return map
}

function presentViewpoints(brief: MarketBrief): BriefView['viewpoints'] {
  if (!brief.viewpoints)
    return null
  const shown = displayedSectionNumbers(brief)
  // 段落被攔下不顯示時不標：那個論點不是整體性的，標「整體判斷」會說錯。
  const toSection = (ref: number | null | undefined): ViewpointView['section'] =>
    ref === undefined ? null : ref === null ? 'overall' : shown.get(ref) ?? null
  const points = (list: string[], refs: (number | null)[] | undefined): ViewpointView[] => list.flatMap((p, i) => {
    const text = redactBlockedSentences(p)
    return text ? [{ text, section: refs ? toSection(refs[i]) : null }] : []
  })
  return {
    supportPoints: points(brief.viewpoints.supportPoints, brief.viewpoints.supportRefs),
    riskPoints: points(brief.viewpoints.riskPoints, brief.viewpoints.riskRefs),
    netRead: redactBlockedSentences(brief.viewpoints.netRead),
  }
}

const MAX_INDUSTRY_CITATIONS = 3

// 產業理由由 synthesizer 綜合連動鏈寫成，chain-grouper 再把每條鏈歸到它屬於的產業（forceGroup），
// 所以歸到同一產業的鏈所引用的來源就是理由的依據。網址要在報告引用清單裡才列，標題與 http 過濾跟引用來源一致。
function industryCitations(brief: MarketBrief, name: string, byUrl: Map<string, CitationLink>): CitationLink[] {
  const urls = new Set((brief.cascadeChains ?? []).filter(c => c.forceGroup === name).flatMap(c => c.citations.map(x => x.url)))
  return [...urls].flatMap((u) => {
    const c = byUrl.get(u)
    return c ? [c] : []
  }).slice(0, MAX_INDUSTRY_CITATIONS)
}

// 產業名被攔截就整筆不顯示：只剩方向沒有對象，讀者無從判斷。
function presentIndustries(brief: MarketBrief, citations: CitationLink[]): IndustryView[] {
  const byUrl = new Map(citations.map(c => [c.url, c]))
  return brief.affectedIndustries.flatMap((i) => {
    const name = redactBlockedSentences(i.name)
    return name
      ? [{ name, direction: i.direction, confidence: i.confidence, reasoning: redactBlockedSentences(i.reasoning), citations: industryCitations(brief, i.name, byUrl) }]
      : []
  })
}

export function presentBrief(date: string, brief: MarketBrief, selectedNews: readonly NewsLink[]): BriefView {
  const citations = citationLinks(brief)
  return {
    date,
    headline: redactBlockedSentences(brief.headline) || `${date} 總經報告`,
    dailyThesis: redactBlockedSentences(brief.dailyThesis ?? ''),
    summary: redactBlockedSentences(brief.summary),
    narrative: presentNarrative(brief, citations),
    viewpoints: presentViewpoints(brief),
    industries: presentIndustries(brief, citations),
    selectedNews: selectedNews.map(n => ({ id: n.id, title: redactBlockedSentences(n.title) || WITHHELD_NEWS_TITLE })),
    citations,
    disclaimer: brief.disclaimer,
  }
}
