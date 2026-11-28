import type { GlossaryEntry } from './glossary'
import type { BriefView } from './present-brief'
import { annotateHtml, escapeHtml } from './glossary'
import { renderMarkdown } from './markdown'

/**
 * 講義頁各區塊的 HTML：已跳脫並標好術語，給元件用 set:html 輸出。
 * 每個術語整頁只標第一次出現，所以依閱讀順序一次算完，不交給子元件各自標。
 */
export function briefHtml(brief: BriefView, glossary: readonly GlossaryEntry[]) {
  const narrative = brief.narrative
  const sections = narrative?.sections ?? []
  // 主軸、小標與結論句不標：主軸已有螢光筆，再疊點線最難讀；小標與結論句有自己的樣式。
  // 產業理由收在點開的列裡，排到最後才標，本文標過的術語就不會只藏在收合的列裡。
  const seen = new Set<string>()
  const glossMarkdown = (text: string) => annotateHtml(renderMarkdown(text), glossary, seen)
  const glossText = (text: string) => annotateHtml(escapeHtml(text), glossary, seen)
  const thesisHtml = escapeHtml(brief.dailyThesis || brief.summary)
  const introHtml = narrative ? glossMarkdown(narrative.intro) : ''
  const bodyHtml = sections.map(s => glossMarkdown(s.body))
  const outroHtml = narrative?.outro ? glossMarkdown(narrative.outro) : ''
  const summaryHtml = !narrative && brief.summary && brief.dailyThesis ? glossText(brief.summary) : ''
  // 引用的主軸與頁首文字相同（主軸被攔下時頁首改顯示摘要），同樣不標術語。
  const viewpoints = brief.viewpoints && {
    thesisHtml,
    support: brief.viewpoints.supportPoints.map(({ text, section }) => ({ html: glossText(text), section })),
    risk: brief.viewpoints.riskPoints.map(({ text, section }) => ({ html: glossText(text), section })),
    netReadHtml: brief.viewpoints.netRead ? glossText(brief.viewpoints.netRead) : '',
  }
  const industries = brief.industries.map(({ reasoning, ...rest }) => ({ ...rest, reasoningHtml: reasoning ? glossText(reasoning) : '' }))
  return { thesisHtml, introHtml, bodyHtml, outroHtml, summaryHtml, viewpoints, industries }
}
