import type { EvidenceClaim, MarketBrief, Narrative } from '@suanomics/shared'
import { describe, expect, it } from 'vitest'
import { measureRefChecks, measureTraceability } from './ledger-traceability.js'

function claim(id: string, text: string, refs: EvidenceClaim['evidenceRefs'] = [], kind: EvidenceClaim['kind'] = 'fact'): EvidenceClaim {
  return { id, kind, claimType: 'named-number', claim: text, evidenceRefs: refs, asOf: '2026-06-26', checks: [] }
}

function narrativeOf(body: string): Narrative {
  return {
    intro: '導言。',
    sections: [{ heading: '標題', takeaway: null, body, relatedNewsIds: [], claimIds: [], citationUrls: ['https://x'] }],
    outro: '結語。',
  }
}

function briefOf(over: Partial<MarketBrief>): MarketBrief {
  return {
    headline: '標題',
    summary: '摘要',
    relatedNews: [],
    affectedIndustries: [],
    relatedETFs: [],
    reasoningChain: ['r1', 'r2'],
    citations: [{ url: 'https://x', title: 't', quote: 'q' }],
    disclaimer: '本分析僅供參考、非投資建議、實際投資請諮詢專業人士',
    ...over,
  }
}

// C 類：讀者面有數字、ledger 查不到。既有 ① 只掃 narrative，
// 而接上 claimLedger 之後 viewpoints 的數字密度大幅上升（riskPoints 帶具名數字 40%→68%），
// 等於新開了一個沒被追溯量測涵蓋的讀者面。
describe('measureTraceability viewpoints 面', () => {
  const vpOf = (support: string[], risk: string[], netRead: string): MarketBrief['viewpoints'] => ({
    supportPoints: support,
    riskPoints: risk,
    netRead,
  })

  it('counts viewpoints numbers and matches them against the ledger pool', () => {
    const m = measureTraceability(briefOf({
      viewpoints: vpOf(['台積電營收成長 45%。'], ['費半收於 12098 點。'], '綜合判斷。'),
      claimLedger: [claim('c1', '台積電營收成長 45%')],
    }))
    expect(m.viewpoints).toEqual({ total: 2, matched: 1 })
  })

  // ★ 這條是本次改動存在的理由：viewpoints **不得**併進 bySurface／totals。
  // totals 是 bySurface 的總和，把新面加進去會改動分母，讓 2026-08 之前的
  // 追溯率基線（~95.5%）失去可比性。
  it('does NOT fold viewpoints into bySurface or totals', () => {
    const withVp = measureTraceability(briefOf({
      summary: '加權指數收在 23150 點。',
      viewpoints: vpOf(['另一個數字 777。'], ['再一個 888。'], '還有 999。'),
      claimLedger: [claim('c1', '加權指數收 23150 點')],
    }))
    const withoutVp = measureTraceability(briefOf({
      summary: '加權指數收在 23150 點。',
      claimLedger: [claim('c1', '加權指數收 23150 點')],
    }))
    expect(withVp.totals).toEqual(withoutVp.totals)
    expect(Object.keys(withVp.bySurface)).not.toContain('viewpoints')
    expect(withVp.viewpoints.total).toBe(3)
  })

  it('reports zero when the brief has no viewpoints', () => {
    expect(measureTraceability(briefOf({})).viewpoints).toEqual({ total: 0, matched: 0 })
  })

  it('covers all three viewpoints fields', () => {
    const m = measureTraceability(briefOf({
      viewpoints: vpOf(['支持 11。'], ['風險 22。'], '淨讀 33。'),
      claimLedger: [],
    }))
    expect(m.viewpoints).toEqual({ total: 3, matched: 0 })
  })
})

describe('measureTraceability 讀者面數字對 ledger', () => {
  it('counts a reader-facing number that exists in the ledger as matched', () => {
    const m = measureTraceability(briefOf({
      summary: '加權指數收在 23150 點。',
      claimLedger: [claim('c1', '加權指數收 23150 點')],
    }))
    expect(m.bySurface.summary).toEqual({ total: 1, matched: 1 })
    expect(m.totals.matched).toBe(1)
  })

  it('counts a number absent from the ledger as unmatched', () => {
    const m = measureTraceability(briefOf({
      summary: '加權指數收在 23150 點。',
      claimLedger: [claim('c1', '費半收 5432.1 點')],
    }))
    expect(m.bySurface.summary).toEqual({ total: 1, matched: 0 })
  })

  it('matches across thousands separators and full-width digits', () => {
    // 兩邊寫法不同但是同一個數字——用數值比對而不是字串包含
    const m = measureTraceability(briefOf({
      summary: '加權指數收在 23,150 點。',
      claimLedger: [claim('c1', '加權指數收 ２３１５０ 點')],
    }))
    expect(m.bySurface.summary).toEqual({ total: 1, matched: 1 })
  })

  it('excludes years and calendar dates from the denominator', () => {
    // 2026 與「8 月 4 日」是曆面不是資料，計進分母會系統性壓低這個比例
    const m = measureTraceability(briefOf({
      summary: '2026 年 8 月 4 日、加權指數收在 23150 點。',
      claimLedger: [claim('c1', '加權指數收 23150 點')],
    }))
    expect(m.bySurface.summary).toEqual({ total: 1, matched: 1 })
  })

  it('covers headline / summary / reasoningChain / narrative separately', () => {
    const m = measureTraceability(briefOf({
      headline: '費半收 5432.1 點',
      summary: '加權指數 23150 點',
      reasoningChain: ['美債殖利率 4.32%', '無數字的一句'],
      narrative: narrativeOf(`外資賣超 120 億元。${'字'.repeat(260)}`),
      claimLedger: [claim('c1', '費半收 5432.1 點'), claim('c2', '加權指數收 23150 點')],
    }))
    expect(m.bySurface.headline).toEqual({ total: 1, matched: 1 })
    expect(m.bySurface.summary).toEqual({ total: 1, matched: 1 })
    expect(m.bySurface.reasoningChain).toEqual({ total: 1, matched: 0 })
    expect(m.bySurface.narrative).toEqual({ total: 1, matched: 0 })
    expect(m.totals).toEqual({ total: 4, matched: 2 })
  })

  it('counts a repeated number once per occurrence', () => {
    const m = measureTraceability(briefOf({
      summary: '加權指數 23150 點、成交 3200 億元、尾盤仍守 23150 點。',
      claimLedger: [claim('c1', '加權指數收 23150 點')],
    }))
    expect(m.bySurface.summary).toEqual({ total: 3, matched: 2 })
  })

  it('reports zero matched when the ledger is absent（旗標關閉的那一臂）', () => {
    const m = measureTraceability(briefOf({ summary: '加權指數 23150 點。' }))
    expect(m.bySurface.summary).toEqual({ total: 1, matched: 0 })
    expect(m.ledgerClaims).toBe(0)
  })

  it('treats a null narrative as zero numbers rather than skipping the surface', () => {
    const m = measureTraceability(briefOf({ narrative: null, claimLedger: [claim('c1', '費半 5432.1')] }))
    expect(m.bySurface.narrative).toEqual({ total: 0, matched: 0 })
  })

  it('reads numbers out of narrative heading and takeaway as well as body', () => {
    const base = narrativeOf('內文沒有數字。'.repeat(40))
    const section = base.sections[0]
    if (!section)
      throw new Error('fixture 壞了：narrativeOf 應該產一個 section')
    const n: Narrative = { ...base, sections: [{ ...section, heading: '費半收 5432.1 點', takeaway: '加權指數守住 23150 點。' }] }
    const m = measureTraceability(briefOf({ narrative: n, claimLedger: [claim('c1', '費半收 5432.1 點')] }))
    expect(m.bySurface.narrative).toEqual({ total: 2, matched: 1 })
  })
})

describe('measureTraceability unsupported fact claim', () => {
  it('counts fact claims with no evidenceRefs', () => {
    const m = measureTraceability(briefOf({
      claimLedger: [
        claim('c1', '有依據', [{ kind: 'series', seriesId: 'us-sox', asOf: '2026-06-26' }]),
        claim('c2', '沒依據'),
        claim('c3', '也沒依據'),
      ],
    }))
    expect(m.factClaims).toBe(3)
    expect(m.unsupportedFactClaims).toBe(2)
  })

  it('does not count inference or scenario claims as unsupported facts', () => {
    // 推論本來就不必掛證據，混進來會讓閾值訂在錯的分母上
    const m = measureTraceability(briefOf({
      claimLedger: [claim('c1', '推論', [], 'inference'), claim('c2', '情境', [], 'scenario')],
    }))
    expect(m.factClaims).toBe(0)
    expect(m.unsupportedFactClaims).toBe(0)
    expect(m.ledgerClaims).toBe(2)
  })
})

describe('measureRefChecks（可推翻條件要看 D2／D3）', () => {
  const CTX = {
    citations: [{ url: 'https://ok.example/1', quote: '引文' }],
    seriesPoints: [{ seriesId: 'us-sox', asOf: '2026-06-26', value: 5432.1 }],
    knownSeriesIds: ['us-sox', 'taiex-close'],
    calendarDates: [] as string[],
  }
  const cite = (url: string) => ({ kind: 'citation' as const, url })
  const series = (seriesId: string, asOf: string) => ({ kind: 'series' as const, seriesId, asOf })

  it('passes D2 when the citation url is in brief.citations', () => {
    const r = measureRefChecks([claim('c1', '費半收 5432.1 點', [cite('https://ok.example/1')])], CTX)
    expect(r).toMatchObject({ d2Applicable: 1, d2Passed: 1, refsDroppedD2: 0 })
  })

  it('fails D2 and counts the dropped ref when the url is unknown', () => {
    const r = measureRefChecks([claim('c1', '費半收 5432.1 點', [cite('https://evil.example/x')])], CTX)
    expect(r).toMatchObject({ d2Applicable: 1, d2Passed: 0, refsDroppedD2: 1 })
  })

  it('does not count a claim without citation refs as D2-applicable', () => {
    // 不適用算成通過的話，一個完全沒 ref 的 claim 會拿到乾淨的成績單
    const r = measureRefChecks([claim('c1', '費半收 5432.1 點', [series('us-sox', '2026-06-26')])], CTX)
    expect(r.d2Applicable).toBe(0)
    expect(r).toMatchObject({ d3Applicable: 1, d3Passed: 1 })
  })

  it('fails D3 when the series point is not in the snapshot', () => {
    const r = measureRefChecks([claim('c1', '費半收 5432.1 點', [series('us-sox', '2020-01-01')])], CTX)
    expect(r).toMatchObject({ d3Applicable: 1, d3Passed: 0, refsDroppedD3: 1 })
  })

  it('fails D3 for an unknown series id', () => {
    const r = measureRefChecks([claim('c1', '數字 1', [series('nope', '2026-06-26')])], CTX)
    expect(r).toMatchObject({ d3Applicable: 1, d3Passed: 0, refsDroppedD3: 1 })
  })

  it('returns all zeros for an empty ledger', () => {
    expect(measureRefChecks([], CTX)).toEqual({
      d2Applicable: 0,
      d2Passed: 0,
      d3Applicable: 0,
      d3Passed: 0,
      refsDroppedD2: 0,
      refsDroppedD3: 0,
    })
  })
})
