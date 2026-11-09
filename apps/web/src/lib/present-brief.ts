import type { MarketBrief } from '@suanomics/shared'
import { MarketBriefSchema } from '@suanomics/shared'
import { redactBlockedSentences } from './compliance'

export interface CitationLink { title: string, url: string }
export interface NewsLink { id: number, title: string }

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
  viewpoints: { supportPoints: string[], riskPoints: string[], netRead: string } | null
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
    intro: redactBlockedSentences(brief.narrative.intro),
    sections: brief.narrative.sections.flatMap((s) => {
      const body = redactBlockedSentences(s.body)
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
    outro: redactBlockedSentences(brief.narrative.outro),
  }
}

function presentViewpoints(brief: MarketBrief): BriefView['viewpoints'] {
  if (!brief.viewpoints)
    return null
  const points = (list: string[]): string[] => list.map(redactBlockedSentences).filter(Boolean)
  return {
    supportPoints: points(brief.viewpoints.supportPoints),
    riskPoints: points(brief.viewpoints.riskPoints),
    netRead: redactBlockedSentences(brief.viewpoints.netRead),
  }
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
    selectedNews: selectedNews.map(n => ({ id: n.id, title: redactBlockedSentences(n.title) || WITHHELD_NEWS_TITLE })),
    citations,
    disclaimer: brief.disclaimer,
  }
}
