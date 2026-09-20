import type { ArmResult } from './ledger-ab-report.js'
import { describe, expect, it } from 'vitest'
import { pairedDaily, pct, renderArmReport, summarizeArm } from './ledger-ab-report.js'

function result(over: Partial<ArmResult> & Pick<ArmResult, 'arm'>): ArmResult {
  return {
    date: '2026-07-26',
    file: '/tmp/x.json',
    newsCount: 6,
    audit: { failed: false, retryReason: null, fabricationStripped: 0, claimIdsStripped: 0, claimCitationUrlsDropped: 0, claimCitationSections: 0, claimUnboundNumbers: 0, claimCheckedNumbers: 0, claimIdsTruncated: 0 },
    sections: 3,
    chars: 2000,
    trace: {
      bySurface: {
        headline: { total: 0, matched: 0 },
        summary: { total: 0, matched: 0 },
        reasoningChain: { total: 0, matched: 0 },
        narrative: { total: 10, matched: 5 },
      },
      totals: { total: 10, matched: 5 },
      ledgerClaims: 12,
      factClaims: 8,
      unsupportedFactClaims: 2,
      ...over.trace,
    },
    ...over,
  }
}

const BASE_INPUT = {
  started: '2026-08-08T09:00:00.000Z',
  finished: '2026-08-08T09:30:00.000Z',
  dates: ['2026-07-26'],
  limit: 0,
  failures: [] as string[],
  calls: 30,
  costUsd: 1.2345,
  narrativeModel: { provider: 'gemini', model: 'gemini-3.1-pro-preview' },
  analystModel: { provider: 'gemini', model: 'gemini-3.5-flash' },
  outDir: '/out',
}

describe('pct', () => {
  it('returns n/a for a zero denominator（不是 0%——沒有樣本與全部落空是兩件事）', () => {
    expect(pct(0, 0)).toBe('n/a')
  })
  it('formats one decimal place', () => {
    expect(pct(1, 3)).toBe('33.3%')
  })
})

describe('summarizeArm', () => {
  it('sums only the rows of that arm', () => {
    const rows = [
      result({ arm: 'A1', chars: 100 }),
      result({ arm: 'A1', chars: 200 }),
      result({ arm: 'B', chars: 999 }),
    ]
    const s = summarizeArm(rows, 'A1')
    expect(s.days).toBe(2)
    expect(s.chars).toBe(300)
    expect(s.numbers).toBe(20)
    expect(s.matched).toBe(10)
  })

  it('counts degraded days separately（narrative=null 的天字數是 0、平均會被拉低）', () => {
    const rows = [
      result({ arm: 'A1' }),
      result({ arm: 'A1', chars: 0, sections: 0, audit: { failed: true, retryReason: 'zod-parse', fabricationStripped: 0, claimIdsStripped: 0, claimCitationUrlsDropped: 0, claimCitationSections: 0, claimUnboundNumbers: 0, claimCheckedNumbers: 0, claimIdsTruncated: 0 } }),
    ]
    expect(summarizeArm(rows, 'A1').failedDays).toBe(1)
  })

  it('returns zeros for an arm with no rows', () => {
    expect(summarizeArm([], 'B')).toMatchObject({ days: 0, numbers: 0, matched: 0 })
  })
})

describe('pairedDaily：逐日配對，不是彙總', () => {
  function day(date: string, a1: [number, number], a2: [number, number], b: [number, number]): ArmResult[] {
    const t = ([matched, total]: [number, number]): ArmResult['trace'] => ({
      bySurface: {
        headline: { total: 0, matched: 0 },
        summary: { total: 0, matched: 0 },
        reasoningChain: { total: 0, matched: 0 },
        narrative: { total, matched },
      },
      totals: { total, matched },
      ledgerClaims: 12,
      factClaims: 8,
      unsupportedFactClaims: 1,
    })
    return [
      result({ arm: 'A1', date, trace: t(a1) }),
      result({ arm: 'A2', date, trace: t(a2) }),
      result({ arm: 'B', date, trace: t(b) }),
    ]
  }

  it('counts the days where the A arms beat B, not the pooled ratio', () => {
    // 關鍵：彙總（把所有天的分子分母加總）會讓某一天的大分母主導，
    // 把 5/5 同向的效果稀釋成「看起來沒過雜訊」。配對比較保住每天的對照。
    const results = [
      ...day('d1', [23, 25], [27, 29], [19, 32]),
      ...day('d2', [23, 36], [25, 28], [18, 35]),
      ...day('d3', [32, 47], [29, 44], [28, 48]),
    ]
    const p = pairedDaily(results)
    expect(p.days).toBe(3)
    expect(p.aWins).toBe(3)
    expect(p.effects).toHaveLength(3)
    expect(p.medianEffect).toBeGreaterThan(0)
  })

  it('reports the within-arm noise per day, not pooled', () => {
    // A1 92.0 / A2 93.1 → 1.1pt；A1 63.9 / A2 89.3 → 25.4pt。中位數才是典型值
    const results = [...day('d1', [23, 25], [27, 29], [19, 32]), ...day('d2', [23, 36], [25, 28], [18, 35])]
    const p = pairedDaily(results)
    expect(p.medianNoise).toBeCloseTo(13.3, 0)
  })

  it('counts a day where B wins', () => {
    const results = day('d1', [10, 100], [12, 100], [50, 100])
    expect(pairedDaily(results).aWins).toBe(0)
  })

  it('skips a day whose arms are incomplete（缺一臂就無從配對）', () => {
    const results = [result({ arm: 'A1', date: 'd1' }), result({ arm: 'B', date: 'd1' })]
    expect(pairedDaily(results).days).toBe(0)
  })

  it('reports how many days were dropped, not just how many were compared', () => {
    // 靜默丟掉的日子是「跑完了、數字合理、但是錯的」最典型的入口：
    // 4 天可比、16 天缺臂被丟掉，卻仍然照 4 天下結論
    const results = [
      ...day('d1', [80, 100], [79, 100], [50, 100]),
      result({ arm: 'A1', date: 'd2' }),
      result({ arm: 'B', date: 'd2' }),
    ]
    const p = pairedDaily(results)
    expect(p.days).toBe(1)
    expect(p.requestedDays).toBe(2)
  })

  it('tracks the A1-only comparison separately from the A-mean one', () => {
    // 2026-08-08 實跑：A 平均 5/5，但 A1 單臂只有 4/5（07-26 A1 66.7 < B 70.3）。
    // pairwise judge 比的是 A1，所以兩者混用會讓「兩個方法同向」講得比證據強。
    const results = [
      ...day('d1', [90, 100], [90, 100], [50, 100]), // A1 勝
      ...day('d2', [40, 100], [90, 100], [50, 100]), // A 平均勝、A1 輸
    ]
    const p = pairedDaily(results)
    expect(p.aWins).toBe(2)
    expect(p.a1Wins).toBe(1)
  })

  it('skips a day with a zero denominator（沒有數字可比、不是 0%）', () => {
    const results = day('d1', [0, 0], [0, 0], [0, 0])
    expect(pairedDaily(results).days).toBe(0)
  })
})

describe('renderArmReport 的結論句', () => {
  function trace(total: number, matched: number): ArmResult['trace'] {
    return {
      bySurface: {
        headline: { total: 0, matched: 0 },
        summary: { total: 0, matched: 0 },
        reasoningChain: { total: 0, matched: 0 },
        narrative: { total, matched },
      },
      totals: { total, matched },
      ledgerClaims: 12,
      factClaims: 8,
      unsupportedFactClaims: 2,
    }
  }

  function armsFor(date: string, a: number, bRate: number): ArmResult[] {
    return [
      result({ arm: 'A1', date, trace: trace(100, a) }),
      result({ arm: 'A2', date, trace: trace(100, a - 1) }),
      result({ arm: 'B', date, trace: trace(100, bRate) }),
    ]
  }

  it('refuses to conclude from a single day even when A wins it', () => {
    // 一天的全勝是硬幣丟一次就正面——報告必須說樣本不足，不能讓讀者拿去做決定
    const out = renderArmReport({ ...BASE_INPUT, results: armsFor('d1', 80, 50) })
    expect(out).toContain('樣本不足以下定論')
  })

  it('allows the direction once five days all point the same way', () => {
    const results = ['d1', 'd2', 'd3', 'd4', 'd5'].flatMap(d => armsFor(d, 80, 50))
    const out = renderArmReport({ ...BASE_INPUT, results })
    expect(out).toContain('方向可以講')
    expect(out).toContain('5/5 天 A 勝')
  })

  it('refuses when the days disagree, however large the pooled gap looks', () => {
    // 3 天 A 勝、2 天 B 勝：彙總可能仍是 A 領先，但方向不一致就不准宣稱
    const results = [
      ...armsFor('d1', 90, 10),
      ...armsFor('d2', 90, 10),
      ...armsFor('d3', 90, 10),
      ...armsFor('d4', 10, 90),
      ...armsFor('d5', 10, 90),
    ]
    const out = renderArmReport({ ...BASE_INPUT, results })
    expect(out).toContain('3/5 天 A 勝')
    expect(out).toContain('不足以宣稱效果')
  })

  it('keeps the pooled numbers but marks them as not the verdict', () => {
    const out = renderArmReport({ ...BASE_INPUT, results: armsFor('d1', 80, 50) })
    expect(out).toContain('彙總不是判準')
  })

  it('refuses to conclude when the median effect is smaller than the median noise', () => {
    // 5 天全同向、但每天只贏 0.5pt 而同臂雜訊 10pt：方向一致只是因為雜訊剛好同號
    const results = ['d1', 'd2', 'd3', 'd4', 'd5'].flatMap(d => [
      result({ arm: 'A1', date: d, trace: trace(1000, 505) }),
      result({ arm: 'A2', date: d, trace: trace(1000, 605) }),
      result({ arm: 'B', date: d, trace: trace(1000, 550) }),
    ])
    const out = renderArmReport({ ...BASE_INPUT, results })
    expect(out).toContain('小於同臂雜訊')
  })

  it('flags when the A1-only comparison disagrees with the A-mean one', () => {
    const results = [
      ...['d1', 'd2', 'd3', 'd4'].flatMap(d => armsFor(d, 90, 50)),
      result({ arm: 'A1', date: 'd5', trace: trace(100, 40) }),
      result({ arm: 'A2', date: 'd5', trace: trace(100, 90) }),
      result({ arm: 'B', date: 'd5', trace: trace(100, 50) }),
    ]
    const out = renderArmReport({ ...BASE_INPUT, results })
    expect(out).toContain('A1 單臂')
    expect(out).toContain('4/5')
  })

  it('says the p-value is one-sided（字面上的「全同向」是雙倍）', () => {
    const results = ['d1', 'd2', 'd3', 'd4', 'd5'].flatMap(d => armsFor(d, 80, 50))
    const out = renderArmReport({ ...BASE_INPUT, results })
    expect(out).toContain('單側')
  })

  it('reports dropped days in the verdict line', () => {
    const results = [
      ...['d1', 'd2', 'd3', 'd4'].flatMap(d => armsFor(d, 80, 50)),
      result({ arm: 'A1', date: 'd5' }),
    ]
    const out = renderArmReport({ ...BASE_INPUT, results })
    expect(out).toContain('丟掉 1 天')
  })

  it('warns that ② is 0 by definition in arm B, not a finding', () => {
    // B 沒吃 ledger → claimIds 必空 → 反推恆 0。少了這句，報告會被讀成「ledger 讓反推率從 0 到 100%」
    const out = renderArmReport({ ...BASE_INPUT, results: [result({ arm: 'A1' }), result({ arm: 'B' })] })
    expect(out).toContain('恆為 0')
    expect(out).toContain('定義使然')
  })

  it('warns that the ① denominator differs between arms', () => {
    const results = [result({ arm: 'A1', trace: trace(36, 23) }), result({ arm: 'B', trace: trace(43, 19) })]
    const out = renderArmReport({ ...BASE_INPUT, results })
    expect(out).toContain('分母兩臂不同')
    expect(out).toContain('A1 36')
    expect(out).toContain('B 43')
  })

  it('lists failures instead of hiding them', () => {
    const out = renderArmReport({ ...BASE_INPUT, results: [result({ arm: 'A1' })], failures: ['2026-07-26/12：timeout'] })
    expect(out).toContain('2026-07-26/12：timeout')
  })

  it('says 無 when nothing failed', () => {
    const out = renderArmReport({ ...BASE_INPUT, results: [result({ arm: 'A1' })] })
    expect(out).toContain('失敗跳過：0 筆（無）')
  })

  it('includes the pairwise command so 可讀性不會被誤當已量', () => {
    const out = renderArmReport({ ...BASE_INPUT, results: [result({ arm: 'A1' })] })
    expect(out).toContain('brief:quality')
    expect(out).toContain('不含可讀性判定')
  })
})
