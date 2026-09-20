import type { MarketBrief, Narrative } from '@suanomics/shared'
import { describe, expect, it } from 'vitest'
import { buildKicker, buildLayerCounts, buildReportMeta, computeReadingMinutes } from './report-meta.js'

function nv(bodies: string[]): Narrative {
  return {
    intro: '',
    outro: '',
    sections: bodies.map((b, i) => ({ heading: `h${i}`, body: b, takeaway: null, relatedNewsIds: [], claimIds: [], citationUrls: [] })),
  } as Narrative
}

describe('computeReadingMinutes', () => {
  it('shouldFloorAtOneMinute', () => {
    expect(computeReadingMinutes(nv(['短']))).toBe(1)
  })
  it('shouldScaleWithBodyLength', () => {
    expect(computeReadingMinutes(nv(['字'.repeat(700)]))).toBe(2)
  })
  it('shouldSumAcrossSections', () => {
    expect(computeReadingMinutes(nv(['字'.repeat(350), '字'.repeat(350)]))).toBe(2)
  })
})

function mb(over: Partial<MarketBrief> = {}): MarketBrief {
  return { citations: [], narrative: null, cascadeChains: [], ...over } as unknown as MarketBrief
}

describe('buildKicker', () => {
  it('沒有日期時回空字串（載入中不該印一個孤零零的品牌後綴）', () => {
    expect(buildKicker(undefined)).toBe('')
  })

  it('有日期時帶上品牌後綴', () => {
    expect(buildKicker('2026-08-14')).toContain('AI 掐指一算')
  })
})

describe('buildReportMeta', () => {
  it('沒有 brief 時四項全 0', () => {
    expect(buildReportMeta(null, 12)).toEqual({ news: 0, sections: 0, citations: 0, minutes: 0 })
  })

  // 這是這一組最容易錯的邊界：narrative 是 optional，沒有它時 sections 必須是 0 而不是
  // 讓 `.length` 在 undefined 上炸；minutes 同理不能去算一個不存在的 narrative。
  it('brief 有但 narrative 沒有時，sections 與 minutes 是 0', () => {
    const out = buildReportMeta(mb({ citations: [{ url: 'u', title: 't', quote: 'q' }] as never }), 5)
    expect(out.sections).toBe(0)
    expect(out.minutes).toBe(0)
    expect(out.citations).toBe(1)
    expect(out.news).toBe(5)
  })

  it('有 narrative 時 sections 與 minutes 都算得出來', () => {
    const out = buildReportMeta(mb({ narrative: nv(['字'.repeat(700)]) }), 3)
    expect(out.sections).toBe(1)
    expect(out.minutes).toBe(2)
  })
})

describe('buildLayerCounts', () => {
  it('沒有 brief 時兩項都 0', () => {
    expect(buildLayerCounts(null, 0)).toEqual({ chains: 0, sources: 0 })
  })

  it('cascadeChains 缺席時 chains 是 0，不是 undefined', () => {
    expect(buildLayerCounts(mb(), 4).chains).toBe(0)
  })

  // sources 由呼叫端傳入而不是在這裡重算：它是 buildBriefSources 合成後的筆數
  // （一則新聞在 brief 裡有三種身分會被併成一筆），在這裡重數會跟畫面上的清單不一致。
  it('sources 直接採用呼叫端算好的筆數', () => {
    expect(buildLayerCounts(mb({ cascadeChains: [{}, {}] as never }), 7)).toEqual({ chains: 2, sources: 7 })
  })
})
