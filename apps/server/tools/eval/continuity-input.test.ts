import type { MarketBrief } from '@suanomics/shared'
import { describe, expect, it } from 'vitest'
import { buildContinuityUserContent } from './continuity-input.js'

// 最小 MarketBrief fixture（builder 只讀 headline + narrative；其餘欄位填合法占位、不經 schema parse）。
function brief(headline: string, withNarrative = true): MarketBrief {
  return {
    headline,
    summary: headline,
    citations: [{ title: 'c', url: 'https://x', quote: 'q' }],
    narrative: withNarrative
      ? { intro: 'i', sections: [{ heading: 'h', body: 'b', relatedNewsIds: [], claimIds: [], citationUrls: ['https://x'] }], outro: 'o' }
      : null,
    cascadeChains: [],
    relatedNews: [],
    affectedIndustries: [],
    relatedETFs: [],
    reasoningChain: ['a', 'b'],
    disclaimer: '本分析僅供參考、非投資建議、實際投資請諮詢專業人士',
  }
}

describe('buildContinuityUserContent', () => {
  it('含昨日報告 + [甲] + [乙] 三塊、ordering 昨日在最前、甲在乙前', () => {
    const c = buildContinuityUserContent(brief('今A'), brief('今B'), brief('昨'))
    const idxPrev = c.indexOf('# 昨日報告')
    const idxJia = c.indexOf('# [甲]')
    const idxYi = c.indexOf('# [乙]')
    expect(idxPrev).toBeGreaterThanOrEqual(0)
    expect(idxPrev).toBeLessThan(idxJia)
    expect(idxJia).toBeLessThan(idxYi)
    expect(c).toContain('headline：今A')
    expect(c).toContain('headline：今B')
    expect(c).toContain('headline：昨')
    // 綁定內容→區塊：昨 在昨日區塊、今A 在 [甲]、今B 在 [乙]（防甲乙內容對調仍 pass）
    expect(c.indexOf('headline：昨')).toBeLessThan(c.indexOf('headline：今A'))
    expect(c.indexOf('headline：今A')).toBeLessThan(c.indexOf('headline：今B'))
  })
  it('narrative=null 時 graceful：只輸出 headline、不輸出 intro/section/outro 行、不爆', () => {
    const c = buildContinuityUserContent(brief('A', false), brief('B', false), brief('Y', false))
    expect(c).toContain('headline：A')
    expect(c).not.toContain('intro：')
    expect(c).not.toContain('section（')
    expect(c).not.toContain('outro：')
  })
  it('有 narrative 時帶 intro / section（heading）/ outro', () => {
    const c = buildContinuityUserContent(brief('A'), brief('B'), brief('Y'))
    expect(c).toContain('intro：i')
    expect(c).toContain('section（h）：b')
    expect(c).toContain('outro：o')
  })
})
