import type { MarketBrief } from '@suanomics/shared'
import { describe, expect, it } from 'vitest'
import { ablateBrief } from './canary.js'

function fullBrief(): MarketBrief {
  return {
    headline: 'H',
    summary: 'S',
    dailyThesis: '本日論點文字',
    narrative: { intro: 'I', sections: [{ heading: 'sec', body: 'B', relatedNewsIds: [], citationUrls: [] }], outro: 'O' },
    cascadeChains: [{ industry: 'Semis', mechanism: 'M', direction: 'positive', affectedTickers: [], citations: [] }],
    viewpoints: { supportPoints: ['s1', 's2'], riskPoints: ['r1', 'r2'], netRead: 'n'.repeat(150) },
    citations: [{ title: 'c', url: 'https://x', quote: 'Q' }],
  } as unknown as MarketBrief
}

describe('ablateBrief', () => {
  it('移除 dailyThesis 與 viewpoints', () => {
    const out = ablateBrief(fullBrief())
    expect(out.dailyThesis).toBeUndefined()
    expect(out.viewpoints).toBeUndefined()
  })
  it('保留其餘欄位不變', () => {
    const out = ablateBrief(fullBrief())
    expect(out.headline).toBe('H')
    expect(out.summary).toBe('S')
    expect(out.cascadeChains?.length).toBe(1)
    expect(out.narrative?.intro).toBe('I')
    expect(out.citations.length).toBe(1)
  })
  it('不 mutate 輸入', () => {
    const input = fullBrief()
    ablateBrief(input)
    expect(input.dailyThesis).toBe('本日論點文字')
    expect(input.viewpoints).not.toBeUndefined()
  })
  it('輸入本就無 thesis/viewpoints 也不炸', () => {
    const bare = { ...fullBrief(), dailyThesis: undefined, viewpoints: null } as unknown as MarketBrief
    const out = ablateBrief(bare)
    expect(out.dailyThesis).toBeUndefined()
    expect(out.viewpoints).toBeUndefined()
  })
})
