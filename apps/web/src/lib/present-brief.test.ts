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

describe('presentBrief 敘事 markdown', () => {
  it('刪句後敘事不殘留不成對的強調標記', () => {
    const narrative = { ...NARRATIVE, intro: '**建議買進。**開場。', sections: [{ ...NARRATIVE.sections[0] as NonNullable<typeof NARRATIVE.sections[0]>, body: '**建議買進。**本文。' }], outro: '**建議買進。**結尾。' }
    const view = presentBrief('2095-01-01', { ...BASE, narrative }, [])
    expect([view.narrative?.intro, view.narrative?.sections[0]?.body, view.narrative?.outro]).toEqual(['開場。', '本文。', '結尾。'])
  })
})

describe('presentBrief 過濾後的空內容', () => {
  it('本文整段被攔截的段落不輸出', () => {
    const narrative = { ...NARRATIVE, sections: [{ ...NARRATIVE.sections[0] as NonNullable<typeof NARRATIVE.sections[0]>, body: '建議買進。' }] }
    expect(presentBrief('2095-01-01', { ...BASE, narrative }, []).narrative?.sections).toEqual([])
  })
})

describe('presentBrief 牽動產業', () => {
  const INDUSTRY = { name: '半導體', direction: 'negative' as const, confidence: 'medium' as const, reasoning: '費半重挫。' }

  it('帶出產業、方向、信心與理由', () => {
    const view = presentBrief('2095-01-01', { ...BASE, affectedIndustries: [INDUSTRY] }, [])
    expect(view.industries).toEqual([{ name: '半導體', direction: 'negative', confidence: 'medium', reasoning: '費半重挫。', citations: [] }])
  })

  it('理由裡被攔截的句子不進 view', () => {
    const view = presentBrief('2095-01-01', { ...BASE, affectedIndustries: [{ ...INDUSTRY, reasoning: '費半重挫。建議賣出。' }] }, [])
    expect(view.industries[0]?.reasoning).toBe('費半重挫。')
  })

  it('產業名被攔截時整筆不輸出', () => {
    const view = presentBrief('2095-01-01', { ...BASE, affectedIndustries: [{ ...INDUSTRY, name: '建議買進' }, INDUSTRY] }, [])
    expect(view.industries.map(i => i.name)).toEqual(['半導體'])
  })
})

describe('presentBrief 產業理由的出處', () => {
  const INDUSTRY = { name: '半導體業', direction: 'negative' as const, confidence: 'medium' as const, reasoning: '費半重挫。' }
  const CITE_B = { title: '來源 B', url: 'https://b.example/1', quote: 'q' }
  const CITE_C = { title: '來源 C', url: 'https://c.example/1', quote: 'q' }
  const CITE_D = { title: '來源 D', url: 'https://d.example/1', quote: 'q' }
  const chain = (forceGroup: string | null | undefined, urls: string[]) => ({
    industry: '晶圓代工',
    mechanism: 'm',
    affectedTickers: [],
    direction: 'negative' as const,
    citations: urls.map(url => ({ url, title: '鏈上的標題', quote: 'q' })),
    ...(forceGroup === undefined ? {} : { forceGroup }),
  })
  const brief = (cascadeChains: ReturnType<typeof chain>[]): MarketBrief => ({
    ...BASE,
    citations: [CITE_A, CITE_B, CITE_C, CITE_D],
    affectedIndustries: [INDUSTRY],
    cascadeChains,
  })

  it('取歸到該產業的連動鏈引用，標題用報告引用清單裡的標題，同網址只列一次', () => {
    const view = presentBrief('2095-01-01', brief([chain('半導體業', [CITE_B.url, CITE_A.url]), chain('半導體業', [CITE_B.url])]), [])
    expect(view.industries[0]?.citations).toEqual([{ title: '來源 B', url: CITE_B.url }, { title: '來源 A', url: CITE_A.url }])
  })

  it('歸到別的產業、沒歸組或沒有 forceGroup 的鏈不算', () => {
    const view = presentBrief('2095-01-01', brief([chain('金融保險業', [CITE_A.url]), chain(null, [CITE_B.url]), chain(undefined, [CITE_C.url])]), [])
    expect(view.industries[0]?.citations).toEqual([])
  })

  it('不在報告引用清單裡的網址不列', () => {
    const view = presentBrief('2095-01-01', brief([chain('半導體業', ['https://unknown.example/x', CITE_C.url])]), [])
    expect(view.industries[0]?.citations).toEqual([{ title: '來源 C', url: CITE_C.url }])
  })

  it('最多列 3 個出處', () => {
    const view = presentBrief('2095-01-01', brief([chain('半導體業', [CITE_A.url, CITE_B.url, CITE_C.url, CITE_D.url])]), [])
    expect(view.industries[0]?.citations.map(c => c.url)).toEqual([CITE_A.url, CITE_B.url, CITE_C.url])
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
