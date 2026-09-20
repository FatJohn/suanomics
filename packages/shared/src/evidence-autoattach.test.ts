import type { AutoAttachResult, SeriesAnchor } from './evidence-autoattach.js'
import type { EvidenceClaim } from './evidence-claim.js'
import { describe, expect, it } from 'vitest'
import { autoAttachSeriesRefs } from './evidence-autoattach.js'

// 規則設計來自對 184 條真實 claim 離線乾跑：
// 「值比對 ＋ claim 句必須提到該序列 displayName（去空白後）」recall 一條不掉，
// 卻擋掉「台積電營收年增 4.32%」誤掛成美債殖利率那類假 grounding。

// `satisfies` 而非型別標註：讓 displayValue 推成 number（非 number | undefined），
// 否則下方組 seriesPoints 時會撞 exactOptionalPropertyTypes。
const ANCHORS = [
  { seriesId: 'us-sox', displayName: '費城半導體指數', asOf: '2026-07-24', value: 10447.49, displayValue: 10447 },
  { seriesId: 'us-sox', displayName: '費城半導體指數', asOf: '2026-07-23', value: 10910.2, displayValue: 10910 },
  { seriesId: 'us-10y-yield', displayName: '美債 10 年期殖利率', asOf: '2026-07-24', value: 4.32, displayValue: 4.32 },
  { seriesId: 'taiex-close', displayName: '加權指數', asOf: '2026-07-25', value: 23150, displayValue: 23150 },
] satisfies SeriesAnchor[]

function claimOf(claim: string, over: Partial<EvidenceClaim> = {}): EvidenceClaim {
  return { id: 'c1', kind: 'fact', claimType: 'named-number', claim, evidenceRefs: [], asOf: '2026-07-26', checks: [], ...over }
}

function onlyClaim(res: AutoAttachResult): EvidenceClaim {
  const c = res.claims[0]
  if (!c)
    throw new Error('autoAttachSeriesRefs 沒有回傳任何 claim')
  return c
}

function refsOf(claim: EvidenceClaim, anchors: readonly SeriesAnchor[] = ANCHORS): EvidenceClaim['evidenceRefs'] {
  return onlyClaim(autoAttachSeriesRefs([claim], anchors)).evidenceRefs
}

describe('autoAttachSeriesRefs — 命中', () => {
  it('attaches when the claim names the series and copies the rendered value', () => {
    expect(refsOf(claimOf('費城半導體指數於 2026 年 7 月 24 日收在 10,447 點。')))
      .toEqual([{ kind: 'series', seriesId: 'us-sox', asOf: '2026-07-24' }])
  })

  it('attaches for the raw value too', () => {
    expect(refsOf(claimOf('費城半導體指數收在 10,447.49 點。')))
      .toEqual([{ kind: 'series', seriesId: 'us-sox', asOf: '2026-07-24' }])
  })

  // series-config 寫「美債 10 年期殖利率」（有空白），模型寫「美債10年期殖利率」（無空白）。
  // 精確子字串比對會靜默少收 21%——這條就是那個回歸。
  it('matches the display name whitespace-insensitively', () => {
    expect(refsOf(claimOf('2026年7月24日，美債10年期殖利率為4.32%。')))
      .toEqual([{ kind: 'series', seriesId: 'us-10y-yield', asOf: '2026-07-24' }])
  })

  it('attaches the previous-day anchor with its own as-of', () => {
    expect(refsOf(claimOf('費城半導體指數前一日收在 10,910 點。')))
      .toEqual([{ kind: 'series', seriesId: 'us-sox', asOf: '2026-07-23' }])
  })

  // 已知限制：前值落在沒有序列名的子句時不掛。實測 184 條真實 claim 只影響
  // 3 個數字，且那些 claim 已由最新值取得 ref——D1 不受影響、只影響 D4。
  it('does not reach into a later clause that never names the series', () => {
    expect(refsOf(claimOf('費城半導體指數為 10,447 點，前值為 10,910 點。')))
      .toEqual([{ kind: 'series', seriesId: 'us-sox', asOf: '2026-07-24' }])
  })

  it('emits one ref per series-day even when the claim repeats the number', () => {
    expect(refsOf(claimOf('加權指數收在 23,150 點，23,150 點是今年高點。')))
      .toEqual([{ kind: 'series', seriesId: 'taiex-close', asOf: '2026-07-25' }])
  })
})

describe('autoAttachSeriesRefs — 不命中（假 grounding 的防線）', () => {
  it('does not attach when the claim never names the series', () => {
    // 4.32 剛好等於美債殖利率，但這句話講的是台積電營收——純值比對會在這裡造出假 grounding。
    expect(refsOf(claimOf('台積電營收年增 4.32%。'))).toEqual([])
  })

  it('attaches nothing when two named series share the value', () => {
    const tied = [
      { seriesId: 'us-10y-yield', displayName: '美債 10 年期殖利率', asOf: '2026-07-24', value: 4.32, displayValue: 4.32 },
      { seriesId: 'us-2y-yield', displayName: '美債 2 年期殖利率', asOf: '2026-07-24', value: 4.32, displayValue: 4.32 },
    ] satisfies SeriesAnchor[]
    const claim = claimOf('美債 10 年期殖利率與美債 2 年期殖利率同為 4.32%。')
    const out = autoAttachSeriesRefs([claim], tied)
    expect(onlyClaim(out).evidenceRefs).toEqual([])
    expect(out.ambiguousNumbers).toBe(1)
  })

  it('leaves a number alone when an existing ref already backs it', () => {
    const backed = claimOf('費城半導體指數收在 10,447 點。', {
      evidenceRefs: [{ kind: 'series', seriesId: 'us-sox', asOf: '2026-07-24' }],
    })
    expect(refsOf(backed)).toEqual([{ kind: 'series', seriesId: 'us-sox', asOf: '2026-07-24' }])
  })

  it('does not touch claims without checked numbers', () => {
    const causal = claimOf('費城半導體指數的走勢反映了記憶體供給疑慮。', { claimType: 'causal' })
    expect(refsOf(causal)).toEqual([])
  })

  it('keeps a citation ref and adds the series ref alongside it', () => {
    const mixed = claimOf('台積電第二季營收 8,000 億元，同日費城半導體指數收在 10,447 點。', {
      evidenceRefs: [{ kind: 'citation', url: 'https://example.com/a' }],
    })
    expect(refsOf(mixed)).toEqual([
      { kind: 'citation', url: 'https://example.com/a' },
      { kind: 'series', seriesId: 'us-sox', asOf: '2026-07-24' },
    ])
  })
})

describe('autoAttachSeriesRefs — 回報', () => {
  it('counts attached refs across claims', () => {
    const out = autoAttachSeriesRefs([
      claimOf('費城半導體指數收在 10,447 點。'),
      claimOf('加權指數收在 23,150 點。', { id: 'c2' }),
      claimOf('台積電營收年增 4.32%。', { id: 'c3' }),
    ], ANCHORS)
    expect(out.attachedRefs).toBe(2)
    expect(out.ambiguousNumbers).toBe(0)
  })

  it('never mutates the input claims', () => {
    const input = claimOf('費城半導體指數收在 10,447 點。')
    autoAttachSeriesRefs([input], ANCHORS)
    expect(input.evidenceRefs).toEqual([])
  })
})

// 獨立複查（2026-08-05）實跑抓到的三類假 provenance。它們都不會讓任何測試變紅，
// 只會讓 D1 灌水——而那個數字要拿去做不可逆決定。
describe('autoAttachSeriesRefs — 複查找到的假 provenance 回歸', () => {
  it('does not attach across clauses when the number belongs to something else', () => {
    // cascade claim 的常態句型：總經序列 ＋ 個股數字同句不同子句。
    expect(refsOf(claimOf('美債10年期殖利率走升之際，台積電毛利率年增 4.32%。'))).toEqual([])
  })

  it('does not attach an exchange rate to a broker target price', () => {
    const anchors = [
      { seriesId: 'usd-twd', displayName: '美元兌台幣', asOf: '2026-07-25', value: 32.1, displayValue: 32.1 },
    ] satisfies SeriesAnchor[]
    expect(refsOf(claimOf('美元兌台幣走弱，某券商目標價 32.1 元。'), anchors)).toEqual([])
  })

  it('prefers the longest display name when one contains another', () => {
    // 3.1 是一般 CPI 的值，但句子講的是核心 CPI——只有一個序列的值命中，
    // 所以歧義分支救不了，要靠「最長名優先」。
    const anchors = [
      { seriesId: 'us-cpi-yoy', displayName: 'CPI 年增率', asOf: '2026-05-01', value: 3.1, displayValue: 3.1 },
      { seriesId: 'us-core-cpi-yoy', displayName: '核心 CPI 年增率', asOf: '2026-05-01', value: 2.8, displayValue: 2.8 },
    ] satisfies SeriesAnchor[]
    expect(refsOf(claimOf('核心 CPI 年增率為 3.1%。'), anchors)).toEqual([])
  })

  it('still attaches the plain CPI series when the claim really is about it', () => {
    const anchors = [
      { seriesId: 'us-cpi-yoy', displayName: 'CPI 年增率', asOf: '2026-05-01', value: 3.1, displayValue: 3.1 },
      { seriesId: 'us-core-cpi-yoy', displayName: '核心 CPI 年增率', asOf: '2026-05-01', value: 2.8, displayValue: 2.8 },
    ] satisfies SeriesAnchor[]
    expect(refsOf(claimOf('CPI 年增率為 3.1%。'), anchors))
      .toEqual([{ kind: 'series', seriesId: 'us-cpi-yoy', asOf: '2026-05-01' }])
  })
})
