import { describe, expect, it } from 'vitest'
import { armLabels, armsWithoutBaseline, assessSignal, hasNoiseBaseline, labelPairs, pairKind, parseLabel, planArms, UNSTABLE_BASELINE_MAX } from './arms.js'

// 這份測試守的是整個工具的核心設計：**同臂雙跑是預設、不是選配**。
// 2026-08-02 的實驗二第一輪用單跑資料判出「flash 勝 10」，加上同臂對照組後
// 結論反過來變成 11:11 打平——同一個 model 跑第二次犯了跟對照 model 一樣的錯。
// 所以只要缺同臂對照組，這裡就不准回傳可下結論的 verdict。

describe('planArms：預設就是同臂雙跑', () => {
  it('不指定 replicates 時產生 A1,A2,B1,B2', () => {
    expect(planArms({ modelA: 'm-a', modelB: 'm-b' }).map(e => e.label)).toEqual(['A1', 'A2', 'B1', 'B2'])
  })

  it('label 對應到正確的 model 與 arm', () => {
    const plan = planArms({ modelA: 'gemini-3.5-flash', modelB: 'gemini-3.5-flash-lite' })
    expect(plan.map(e => e.model)).toEqual([
      'gemini-3.5-flash',
      'gemini-3.5-flash',
      'gemini-3.5-flash-lite',
      'gemini-3.5-flash-lite',
    ])
    expect(plan.map(e => e.arm)).toEqual(['A', 'A', 'B', 'B'])
    expect(plan.map(e => e.replicate)).toEqual([1, 2, 1, 2])
  })

  it('replicates 可以調高', () => {
    expect(planArms({ modelA: 'a', modelB: 'b', replicates: 3 }).map(e => e.label))
      .toEqual(['A1', 'A2', 'A3', 'B1', 'B2', 'B3'])
  })

  it('replicates < 1 直接丟錯', () => {
    expect(() => planArms({ modelA: 'a', modelB: 'b', replicates: 0 })).toThrow()
    expect(() => armLabels(0)).toThrow()
    expect(() => armLabels(1.5)).toThrow()
  })

  it('armLabels 不需要 model 就能算出 label（--analyze 讀既有 run 檔用）', () => {
    expect(armLabels()).toEqual(['A1', 'A2', 'B1', 'B2'])
    expect(armLabels(1)).toEqual(['A1', 'B1'])
  })
})

describe('parseLabel / pairKind', () => {
  it('從 label 拆出 arm 與第幾跑', () => {
    expect(parseLabel('A1')).toEqual({ arm: 'A', replicate: 1 })
    expect(parseLabel('B12')).toEqual({ arm: 'B', replicate: 12 })
  })

  it('同一個 arm 的兩跑是 within、不同 arm 是 cross', () => {
    expect(pairKind('A1', 'A2')).toBe('within')
    expect(pairKind('A1', 'B1')).toBe('cross')
    expect(pairKind('B2', 'B1')).toBe('within')
  })
})

describe('labelPairs：同臂配對一定排在跨臂之前', () => {
  // 報表照這個順序印，讀的人先看到雜訊底線、才看到跨臂數字。
  it('回傳的順序是 within 全部在前', () => {
    const pairs = labelPairs(['A1', 'A2', 'B1', 'B2'])
    expect(pairs.map(p => `${p.ref}->${p.cand}`)).toEqual([
      'A1->A2',
      'B1->B2',
      'A1->B1',
      'A1->B2',
      'A2->B1',
      'A2->B2',
    ])
    expect(pairs.slice(0, 2).every(p => p.kind === 'within')).toBe(true)
    expect(pairs.slice(2).every(p => p.kind === 'cross')).toBe(true)
  })
})

describe('armsWithoutBaseline / hasNoiseBaseline：structured 與 prose 共用的那道閘門', () => {
  it('每臂都跑滿兩次才算有雜訊底線', () => {
    expect(armsWithoutBaseline(['A1', 'A2', 'B1', 'B2'])).toEqual([])
    expect(hasNoiseBaseline(['A1', 'A2', 'B1', 'B2'])).toBe(true)
  })

  it('只跑一次的臂會被點名', () => {
    expect(armsWithoutBaseline(['A1', 'B1'])).toEqual(['A', 'B'])
    expect(armsWithoutBaseline(['A1', 'A2', 'B1'])).toEqual(['B'])
    expect(hasNoiseBaseline(['A1', 'A2', 'B1'])).toBe(false)
  })

  it('空清單不算有底線（別讓「沒東西」通過閘門）', () => {
    expect(hasNoiseBaseline([])).toBe(false)
  })
})

describe('assessSignal：跨臂差異要跟同臂雜訊比才算數', () => {
  it('任一臂缺同臂對照組 → no-baseline（不得下跨臂結論）', () => {
    const a = assessSignal([{ ref: 'A1', cand: 'B1', kind: 'cross', agreement: 0.5 }])
    expect(a.verdict).toBe('no-baseline')
  })

  it('只有 A 臂有雙跑、B 臂只跑一次 → 一樣是 no-baseline', () => {
    const a = assessSignal([
      { ref: 'A1', cand: 'A2', kind: 'within', agreement: 0.63 },
      { ref: 'A1', cand: 'B1', kind: 'cross', agreement: 0.48 },
    ])
    expect(a.verdict).toBe('no-baseline')
  })

  it('entity-summary 實測數字 → 跨臂差異超出同臂雜訊', () => {
    const a = assessSignal([
      { ref: 'A1', cand: 'A2', kind: 'within', agreement: 0.634 },
      { ref: 'B1', cand: 'B2', kind: 'within', agreement: 0.696 },
      { ref: 'A1', cand: 'B1', kind: 'cross', agreement: 0.483 },
      { ref: 'A2', cand: 'B2', kind: 'cross', agreement: 0.515 },
    ])
    expect(a.verdict).toBe('exceeds-noise')
    expect(a.withinArmFloor).toBeCloseTo(0.634, 10)
    expect(a.crossArmMean).toBeCloseTo(0.499, 10)
  })

  it('news-tagger 實測數字 → 同臂雜訊本身太大、這條路徑量不出 model 差異', () => {
    const a = assessSignal([
      { ref: 'A1', cand: 'A2', kind: 'within', agreement: 0.267 },
      { ref: 'B1', cand: 'B2', kind: 'within', agreement: 0.464 },
      { ref: 'A1', cand: 'B1', kind: 'cross', agreement: 0.17 },
      { ref: 'A2', cand: 'B2', kind: 'cross', agreement: 0.26 },
    ])
    expect(a.verdict).toBe('unstable-baseline')
    expect(UNSTABLE_BASELINE_MAX).toBe(0.5)
  })

  it('跨臂沒有比同臂差 → within-noise（差異落在模型自身抖動裡）', () => {
    const a = assessSignal([
      { ref: 'A1', cand: 'A2', kind: 'within', agreement: 0.70 },
      { ref: 'B1', cand: 'B2', kind: 'within', agreement: 0.72 },
      { ref: 'A1', cand: 'B1', kind: 'cross', agreement: 0.71 },
      { ref: 'A2', cand: 'B2', kind: 'cross', agreement: 0.73 },
    ])
    expect(a.verdict).toBe('within-noise')
  })

  it('雜訊底線取兩臂較低的那個（保守）', () => {
    const a = assessSignal([
      { ref: 'A1', cand: 'A2', kind: 'within', agreement: 0.60 },
      { ref: 'B1', cand: 'B2', kind: 'within', agreement: 0.90 },
      { ref: 'A1', cand: 'B1', kind: 'cross', agreement: 0.65 },
    ])
    expect(a.withinArmFloor).toBeCloseTo(0.60, 10)
    expect(a.verdict).toBe('within-noise')
  })

  it('完全沒有跨臂配對（只跑了一個 model）→ no-baseline', () => {
    const a = assessSignal([
      { ref: 'A1', cand: 'A2', kind: 'within', agreement: 0.634 },
    ])
    expect(a.verdict).toBe('no-baseline')
  })
})
