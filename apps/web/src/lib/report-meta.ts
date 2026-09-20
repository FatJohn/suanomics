import type { MarketBrief, Narrative } from '@suanomics/shared'
import { formatBriefDate } from './format-date.js'

// CJK 閱讀速度約 350 字/分；至少 1 分
export function computeReadingMinutes(narrative: Narrative): number {
  const chars = narrative.sections.reduce((sum, s) => sum + s.body.length, 0)
  return Math.max(1, Math.round(chars / 350))
}

/** 報頭那一行。載入中（還沒有日期）回空字串，不要印一個孤零零的品牌後綴。 */
export function buildKicker(date: string | undefined): string {
  return date ? `${formatBriefDate(date)} · AI 掐指一算` : ''
}

export interface ReportMeta {
  news: number
  sections: number
  citations: number
  minutes: number
}

/**
 * 報頭的四項計數。
 *
 * `newsCount` 由呼叫端傳入而不是在這裡從 brief 掏：那個數字來自當日的 news items
 * （store 的另一條線），不是 brief 自己的欄位——在這裡摸進去會讓這個函式同時依賴
 * 兩個資料來源的形狀。
 */
export function buildReportMeta(brief: MarketBrief | null, newsCount: number): ReportMeta {
  if (!brief)
    return { news: 0, sections: 0, citations: 0, minutes: 0 }
  return {
    news: newsCount,
    // narrative 是 optional：沒有它時 sections 與 minutes 都是 0，而不是讓 .length 炸
    sections: brief.narrative?.sections.length ?? 0,
    citations: brief.citations.length,
    minutes: brief.narrative ? computeReadingMinutes(brief.narrative) : 0,
  }
}

export interface LayerCounts {
  chains: number
  sources: number
}

/**
 * 層別頁籤上的兩個計數。
 *
 * `sourceCount` 同樣由呼叫端傳入：它是 `buildBriefSources` 合成之後的筆數
 * （一則新聞在 brief 裡有被引用／有因果關係／被監測到三種身分，會併成一筆），
 * 在這裡重數任何一個原始陣列都會跟畫面上那份清單對不起來。
 */
export function buildLayerCounts(brief: MarketBrief | null, sourceCount: number): LayerCounts {
  return {
    chains: brief?.cascadeChains?.length ?? 0,
    sources: sourceCount,
  }
}
