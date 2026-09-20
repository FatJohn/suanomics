import type { MarketBrief } from '@suanomics/shared'
import { describe, expect, it } from 'vitest'
import { buildCompareUserContent, normalizeSourceItems } from './quality-input.js'

function brief(tag: string): MarketBrief {
  return {
    headline: `H_${tag}`,
    summary: `S_${tag}`,
    narrative: { intro: `I_${tag}`, sections: [{ heading: 'sec', body: `BODY_${tag}`, relatedNewsIds: [], citationUrls: [] }], outro: `O_${tag}` },
    cascadeChains: [{ industry: 'Semis', mechanism: `MECH_${tag}`, direction: 'positive', affectedTickers: [], citations: [] }],
    citations: [{ title: 'c', url: 'https://x', quote: `Q_${tag}` }],
  } as unknown as MarketBrief
}

describe('buildCompareUserContent', () => {
  it('[甲]=第一參數、[乙]=第二參數、各含主體', () => {
    const out = buildCompareUserContent(brief('A'), brief('B'), [{ title: 'N1', text: 'NEWS1' }])
    expect(out).toContain('[甲]')
    expect(out).toContain('[乙]')
    expect(out).toContain('H_A')
    expect(out).toContain('MECH_A')
    expect(out).toContain('H_B')
    expect(out).toContain('MECH_B')
  })
  it('含共用事實底本（原始新聞）', () => {
    const out = buildCompareUserContent(brief('A'), brief('B'), [{ title: 'N1', text: 'NEWS1' }])
    expect(out).toContain('事實底本')
    expect(out).toContain('N1')
    expect(out).toContain('NEWS1')
  })
  it('含 dailyThesis 時輸出本日論點', () => {
    const b = { ...brief('A'), dailyThesis: '利率重新定價是今日跨市場波動主線' } as unknown as MarketBrief
    const out = buildCompareUserContent(b, brief('B'), [{ title: 'N1', text: 'NEWS1' }])
    expect(out).toContain('利率重新定價是今日跨市場波動主線')
  })
  it('含 viewpoints 時輸出 support/risk/netRead', () => {
    const vp = {
      supportPoints: ['擴產確立', '訂單能見度高'],
      riskPoints: ['利率壓抑估值', '匯率逆風'],
      netRead: '基本面擴張與資金面收縮拉鋸、偏向區間整理',
    }
    const b = { ...brief('A'), viewpoints: vp } as unknown as MarketBrief
    const out = buildCompareUserContent(b, brief('B'), [{ title: 'N1', text: 'NEWS1' }])
    expect(out).toContain('擴產確立')
    expect(out).toContain('利率壓抑估值')
    expect(out).toContain('基本面擴張與資金面收縮拉鋸')
  })
  it('viewpoints=null / 無 dailyThesis 時不輸出空區塊標題', () => {
    const b = { ...brief('A'), viewpoints: null } as unknown as MarketBrief
    const out = buildCompareUserContent(b, brief('B'), [{ title: 'N1', text: 'NEWS1' }])
    expect(out).not.toContain('正反觀點：')
    expect(out).not.toContain('本日論點：')
  })
})

describe('normalizeSourceItems', () => {
  it('news-item 陣列：用 contentText 當 text', () => {
    expect(normalizeSourceItems([{ title: 'T1', contentText: 'BODY1' }])).toEqual([{ title: 'T1', text: 'BODY1' }])
  })
  it('{items:[...]} wrapper：抽出 items', () => {
    expect(normalizeSourceItems({ items: [{ title: 'T1', contentText: 'BODY1' }] })).toEqual([{ title: 'T1', text: 'BODY1' }])
  })
  it('已是 {title,text}：text 優先於 contentText', () => {
    expect(normalizeSourceItems([{ title: 'T', text: 'X', contentText: 'Y' }])).toEqual([{ title: 'T', text: 'X' }])
  })
  it('缺 text/contentText 時 text fallback 回 title', () => {
    expect(normalizeSourceItems([{ title: 'T1' }])).toEqual([{ title: 'T1', text: 'T1' }])
  })
  it('過濾無 title 的雜項與非物件', () => {
    expect(normalizeSourceItems([{ contentText: 'no title' }, 'junk', null, { title: 'OK', contentText: 'B' }]))
      .toEqual([{ title: 'OK', text: 'B' }])
  })
  it('非陣列 / 無 items → []', () => {
    expect(normalizeSourceItems({})).toEqual([])
    expect(normalizeSourceItems(null)).toEqual([])
  })
})
