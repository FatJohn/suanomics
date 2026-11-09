import type { MarketBrief } from '@suanomics/shared'
import { MarketBriefDisclaimer } from '@suanomics/shared'
import { describe, expect, it } from 'vitest'
import { parseBriefJson, presentBrief, safeHttpUrl } from './present-brief'

const CITE_A = { title: '來源 A', url: 'https://a.example/1', quote: '原文引用不上站' }
const BASE: MarketBrief = {
  headline: '美債殖利率走升',
  summary: '摘要內容。',
  relatedNews: [],
  affectedIndustries: [],
  relatedETFs: [],
  reasoningChain: ['a', 'b'],
  citations: [CITE_A],
  disclaimer: MarketBriefDisclaimer,
}
const NARRATIVE = {
  intro: '開場。建議買進。',
  sections: [{ heading: '利率', body: '本文。', takeaway: '結論', relatedNewsIds: [], claimIds: [], citationUrls: [CITE_A.url] }],
  outro: '結尾。',
}

describe('presentBrief', () => {
  it('敘事裡被攔截的句子不進 view', () => {
    const view = presentBrief('2095-01-01', { ...BASE, narrative: NARRATIVE }, [])
    expect(view.narrative?.intro).toBe('開場。')
    expect(JSON.stringify(view)).not.toContain('建議買')
  })

  it('標題被攔截時改用日期標題，h1 不會空白', () => {
    expect(presentBrief('2095-01-01', { ...BASE, headline: '建議買進台積電' }, []).headline).toBe('2095-01-01 總經報告')
  })

  it('段落引用由 url 對回 citation，且不帶 quote', () => {
    const view = presentBrief('2095-01-01', { ...BASE, narrative: NARRATIVE }, [])
    expect(view.narrative?.sections[0]?.citations).toEqual([{ title: '來源 A', url: CITE_A.url }])
    expect(JSON.stringify(view)).not.toContain('原文引用不上站')
  })

  it('非 http(s) 的 citation 不輸出連結', () => {
    const view = presentBrief('2095-01-01', { ...BASE, citations: [CITE_A, { ...CITE_A, url: 'javascript:alert(1)' }] }, [])
    expect(view.citations.map(c => c.url)).toEqual([CITE_A.url])
  })

  it('viewpoints 逐點過濾，被攔截的點不顯示', () => {
    const view = presentBrief('2095-01-01', { ...BASE, viewpoints: { supportPoints: ['需求強', '建議加碼'], riskPoints: ['匯率'], netRead: '淨讀。' } }, [])
    expect(view.viewpoints?.supportPoints).toEqual(['需求強'])
  })
})

describe('presentBrief 過濾後的空內容', () => {
  it('本文整段被攔截的段落不輸出', () => {
    const narrative = { ...NARRATIVE, sections: [{ ...NARRATIVE.sections[0] as NonNullable<typeof NARRATIVE.sections[0]>, body: '建議買進。' }] }
    expect(presentBrief('2095-01-01', { ...BASE, narrative }, []).narrative?.sections).toEqual([])
  })
})

describe('parseBriefJson', () => {
  it('不合 schema 時帶日期丟錯，擋下這次部署而不是發佈未驗證內容', () => {
    expect(() => parseBriefJson('2095-01-01', null)).toThrow('2095-01-01')
  })
})

describe('safeHttpUrl', () => {
  it('只放行 http 與 https', () => {
    expect(safeHttpUrl('https://a.example/x')).toBe('https://a.example/x')
    expect(safeHttpUrl('http://a.example/x')).toBe('http://a.example/x')
    expect(safeHttpUrl('javascript:alert(1)')).toBeNull()
    expect(safeHttpUrl('不是網址')).toBeNull()
  })
})
