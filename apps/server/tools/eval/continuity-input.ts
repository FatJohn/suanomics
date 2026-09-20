import type { MarketBrief } from '@suanomics/shared'

// 取讀者面內容（headline + narrative）；連續性只看讀者實際看到的、不碰 cascade/citations/storyline。
// narrative 可能為 null（graceful degrade）→ 只輸出 headline。
function narrativeBlock(brief: MarketBrief): string[] {
  const L: string[] = []
  L.push(`headline：${brief.headline}`)
  if (brief.narrative) {
    L.push(`intro：${brief.narrative.intro}`)
    for (const s of brief.narrative.sections)
      L.push(`section（${s.heading}）：${s.body}`)
    L.push(`outro：${brief.narrative.outro}`)
  }
  return L
}

// 組 pairwise continuity judge 的 userContent：
// 昨日報告（N-1、基準線）+ [甲]=todayFirst + [乙]=todaySecond（皆讀者面）。
export function buildContinuityUserContent(todayFirst: MarketBrief, todaySecond: MarketBrief, yesterday: MarketBrief): string {
  const L: string[] = []
  L.push('# 昨日報告（N-1）')
  L.push(...narrativeBlock(yesterday))
  L.push('')
  L.push('# [甲]（今日）')
  L.push(...narrativeBlock(todayFirst))
  L.push('')
  L.push('# [乙]（今日）')
  L.push(...narrativeBlock(todaySecond))
  L.push('')
  L.push('請就三維度各判 甲/乙/相當 + 理由、輸出 JSON。')
  return L.join('\n')
}
