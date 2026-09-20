import type { AnalystOutput } from '../../src/agents/types.js'
import { describe, expect, it } from 'vitest'
import { selectCitableSeries } from '../../src/market-data/snapshot.js'
import { emptyMetrics, LATEST, measure, NOW, SNAPSHOT_REPORT_DATE } from './claim-metrics.js'

const URL_A = 'https://example.com/a'

function output(claims: AnalystOutput['claims'], mechanism = ''): AnalystOutput {
  return {
    primaryImpact: 'x',
    reasoning: 'r',
    claims,
    cascadeChains: [{
      industry: '半導體',
      mechanism,
      affectedTickers: [],
      direction: 'negative',
      citations: [{ url: URL_A, title: 't', quote: '費半收在 10447.49 點' }],
    }],
  }
}

// 這條是量測工具自己的守衛，不是產品行為：fixture 的日期若被改到超出新鮮度窗，
// citable 會變成空陣列 → 模型根本無法掛 series ref → D4 數字歸零，而歸零的原因
// 是量測壞了、不是模型不行。兩者在報告上長得一模一樣，所以要用測試擋住。
describe('量測 fixture 的可引用序列', () => {
  it('非空，且包含美股與台股兩區的序列（否則量不到 series ref）', () => {
    const citable = selectCitableSeries(LATEST, NOW, SNAPSHOT_REPORT_DATE)
    const ids = citable.map(c => c.seriesId)
    expect(ids.length).toBeGreaterThan(0)
    expect(ids).toContain('us-sox')
    expect(ids).toContain('taiex-close')
  })

  it('列出的 asOf 與 fixture 的最新點位一致（模型要逐字照抄它）', () => {
    const citable = selectCitableSeries(LATEST, NOW, SNAPSHOT_REPORT_DATE)
    expect(citable.find(c => c.seriesId === 'us-sox')?.asOf).toBe('2026-07-24')
  })
})

describe('measure', () => {
  it('series ref 對得上 fixture 值時 D4 通過、並計入可追溯', () => {
    const m = emptyMetrics()
    measure([output([{
      id: 'c1',
      kind: 'fact',
      claimType: 'named-number',
      claim: '費城半導體指數收在 10447.49 點。',
      evidenceRefs: [{ kind: 'series', seriesId: 'us-sox', asOf: '2026-07-24' }],
      asOf: '2026-07-24',
      checks: [],
    }], '費半收 10447.49 點')], m)
    expect(m.namedNumberPassedD4).toBe(1)
    expect(m.factGrounded).toBe(1)
    expect(m.mechanismNumbers).toBe(1)
    expect(m.mechanismCovered).toBe(1)
    expect(m.mechanismTraceable).toBe(1)
  })

  it('數字對不上 fixture 時 D4 不通過，且該數字不算可追溯（但仍算涵蓋）', () => {
    const m = emptyMetrics()
    measure([output([{
      id: 'c1',
      kind: 'fact',
      claimType: 'named-number',
      claim: '費城半導體指數收在 99999.99 點。',
      evidenceRefs: [{ kind: 'series', seriesId: 'us-sox', asOf: '2026-07-24' }],
      asOf: '2026-07-24',
      checks: [],
    }], '費半收 99999.99 點')], m)
    expect(m.namedNumberPassedD4).toBe(0)
    expect(m.mechanismCovered).toBe(1)
    expect(m.mechanismTraceable).toBe(0)
  })

  it('幻覺 url 計入 D2 桶、且該 fact claim 不算 grounded', () => {
    const m = emptyMetrics()
    measure([output([{
      id: 'c1',
      kind: 'fact',
      claimType: 'causal',
      claim: '需求走弱。',
      evidenceRefs: [{ kind: 'citation', url: 'https://hallucinated.example/x' }],
      asOf: '2026-07-26',
      checks: [],
    }])], m)
    expect(m.refsDroppedD2).toBe(1)
    expect(m.factClaims).toBe(1)
    expect(m.factGrounded).toBe(0)
  })

  it('未知 seriesId 與 asOf 不符分屬不同桶（合成一桶就看不出修法）', () => {
    const m = emptyMetrics()
    measure([output([{
      id: 'c1',
      kind: 'inference',
      claimType: 'causal',
      claim: 'x',
      evidenceRefs: [
        { kind: 'series', seriesId: '我自己編的序列', asOf: '2026-07-24' },
        { kind: 'series', seriesId: 'us-sox', asOf: '2020-01-01' },
      ],
      asOf: '2026-07-24',
      checks: [],
    }])], m)
    expect(m.refsDroppedD3Unknown).toBe(1)
    expect(m.refsDroppedD3AsOf).toBe(1)
  })

  it('零 claim 的新聞：其 chain 數被記下來（產出率的分母之一）', () => {
    const m = emptyMetrics()
    measure([output([], '無數字的機制')], m)
    expect(m.claims).toBe(0)
    expect(m.chainsOfClaimlessNews).toBe(1)
  })
})

// 2026-08-05 獨立複查實測抓到的回歸：mechanism 數字與 claim 數字原本用句子的
// 子字串比對，兩個方向都會錯，而且都不會讓任何測試變紅——只會讓報告的 traceability
// 數字失真，然後那個數字會被拿去做決策。
describe('mechanism 數字比對（回歸）', () => {
  it('假陽性：mechanism 的 10 不得被 claim 的 10447.49 命中', () => {
    const m = emptyMetrics()
    measure([output([{
      id: 'c1',
      kind: 'fact',
      claimType: 'named-number',
      claim: '費城半導體指數收在 10447.49 點。',
      evidenceRefs: [],
      asOf: '2026-07-26',
      checks: [],
      // 原本用「10 年期通膨預期回落」當 mechanism，但後來 `10 年期` 改列為券別、
      // 不再是受檢數字，分母會變 0 而測不到這個回歸。換一個仍然受檢的裸數字。
    }], '費半盤中波動 10 點')], m)
    expect(m.mechanismNumbers).toBe(1)
    expect(m.mechanismCovered).toBe(0)
  })

  it('券別不受檢：mechanism 的 10 年期不進分母', () => {
    const m = emptyMetrics()
    measure([output([], '10 年期通膨預期回落')], m)
    expect(m.mechanismNumbers).toBe(0)
  })

  it('假陰性：mechanism 的 23,150 要對得上 claim 的 23150（千分位）', () => {
    const m = emptyMetrics()
    measure([output([{
      id: 'c1',
      kind: 'fact',
      claimType: 'named-number',
      claim: '加權指數收在 23150 點。',
      evidenceRefs: [],
      asOf: '2026-07-26',
      checks: [],
    }], '加權指數來到 23,150 點')], m)
    expect(m.mechanismNumbers).toBe(1)
    expect(m.mechanismCovered).toBe(1)
  })

  it('claim id 不得被當成數字來源（cN 遮蔽在兩邊都要一致）', () => {
    const m = emptyMetrics()
    measure([output([{
      id: 'c1',
      kind: 'inference',
      claimType: 'causal',
      claim: '需求走弱。',
      evidenceRefs: [],
      asOf: '2026-07-26',
      checks: [],
    }], '產能利用率降至 1 成')], m)
    expect(m.mechanismCovered).toBe(0)
  })
})
