import type { MarketBrief } from '@suanomics/shared'
import { describe, expect, it } from 'vitest'
import { collectBriefNewsRefs, snapshotSourceArticle } from './quality-source-base.js'

function brief(opts: { newsTitlesById?: Record<string, string>, citationUrls?: string[] }): MarketBrief {
  return {
    headline: 'H',
    summary: 'S',
    citations: (opts.citationUrls ?? []).map((url, i) => ({ title: `c${i}`, url, quote: `Q${i}` })),
    newsTitlesById: opts.newsTitlesById,
  } as unknown as MarketBrief
}

describe('collectBriefNewsRefs', () => {
  it('合併兩份 brief 的 newsTitlesById key 與 citation url、各自去重', () => {
    const a = brief({ newsTitlesById: { 3: 'T3', 1: 'T1' }, citationUrls: ['https://x/1', 'https://x/2'] })
    const b = brief({ newsTitlesById: { 1: 'T1', 5: 'T5' }, citationUrls: ['https://x/2', 'https://x/3'] })
    const out = collectBriefNewsRefs([a, b])
    expect(out.ids).toEqual([1, 3, 5])
    expect(out.urls).toEqual(['https://x/1', 'https://x/2', 'https://x/3'])
  })

  it('非數字或 <=0 的 key 略過', () => {
    const a = brief({ newsTitlesById: { '0': 'zero', '-1': 'neg', 'abc': 'nan', '2': 'ok' } })
    const out = collectBriefNewsRefs([a])
    expect(out.ids).toEqual([2])
  })

  it('citations 為空陣列不炸、ids/urls 皆為空', () => {
    const a = brief({ citationUrls: [] })
    const out = collectBriefNewsRefs([a])
    expect(out.ids).toEqual([])
    expect(out.urls).toEqual([])
  })

  it('newsTitlesById 缺席（optional）不炸', () => {
    const a = brief({ citationUrls: ['https://x/1'] })
    const out = collectBriefNewsRefs([a])
    expect(out.ids).toEqual([])
    expect(out.urls).toEqual(['https://x/1'])
  })

  it('ids 升冪排序、urls 保留首次出現順序', () => {
    const a = brief({ newsTitlesById: { 9: 'T9', 4: 'T4' }, citationUrls: ['https://z', 'https://a'] })
    const out = collectBriefNewsRefs([a])
    expect(out.ids).toEqual([4, 9])
    expect(out.urls).toEqual(['https://z', 'https://a'])
  })
})

describe('snapshotSourceArticle', () => {
  it('snapshotBlock 為 null → 回 null', () => {
    expect(snapshotSourceArticle('2026-08-25', null)).toBeNull()
  })

  it('snapshotBlock 全空白 → 回 null', () => {
    expect(snapshotSourceArticle('2026-08-25', '   \n  ')).toBeNull()
  })

  it('snapshotBlock 有內容 → title 帶報告日、text 原樣保留', () => {
    const out = snapshotSourceArticle('2026-08-25', 'TAIEX 收盤 23,456 點')
    expect(out).toEqual({ title: '市場數據快照（2026-08-25）', text: 'TAIEX 收盤 23,456 點' })
  })
})
