import { CROSS_MARKET_SIGNAL_GROUPS, KEY_NUMBER_SERIES } from '@suanomics/shared'
import { describe, expect, it } from 'vitest'
import { SERIES_SPECS } from './series-config.js'
import { FLOW_PHRASES } from './snapshot.js'

describe('series config', () => {
  it('has 26 series with unique ids', () => {
    expect(SERIES_SPECS).toHaveLength(26)
    expect(new Set(SERIES_SPECS.map(s => s.seriesId)).size).toBe(26)
  })
  it('carries the two Nasdaq index series (美股股價指數)', () => {
    const byId = new Map(SERIES_SPECS.map(s => [s.seriesId, s]))
    expect(byId.get('us-sox')?.sourceCode).toBe('SOX')
    expect(byId.get('us-nasdaq-comp')?.sourceCode).toBe('COMP')
    for (const id of ['us-sox', 'us-nasdaq-comp']) {
      expect(byId.get(id)?.source).toBe('nasdaq')
      expect(byId.get(id)?.section).toBe('us-equity')
      expect(byId.get(id)?.unit).toBe('點')
      expect(byId.get(id)?.frequency).toBe('daily')
      expect(byId.get(id)?.transform).toBe('level')
      expect(byId.get(id)?.kind).toBe('level')
    }
  })
  it('carries the 10Y real-rate + breakeven FRED series (real-rate frame)', () => {
    const byId = new Map(SERIES_SPECS.map(s => [s.seriesId, s]))
    expect(byId.get('us-10y-breakeven')?.sourceCode).toBe('T10YIE')
    expect(byId.get('us-10y-real-rate')?.sourceCode).toBe('DFII10')
    for (const id of ['us-10y-breakeven', 'us-10y-real-rate']) {
      expect(byId.get(id)?.source).toBe('fred')
      expect(byId.get(id)?.section).toBe('rates-markets')
    }
  })
  it('spread series reference existing legs', () => {
    const ids = new Set(SERIES_SPECS.map(s => s.seriesId))
    for (const s of SERIES_SPECS.filter(x => x.transform === 'spread')) {
      expect(s.spreadOf, `${s.seriesId} is a spread but missing spreadOf`).toHaveLength(2)
      for (const leg of s.spreadOf ?? [])
        expect(ids.has(leg)).toBe(true)
    }
  })
  // refresh 依 transform 分兩條路跑（spread 從已落地的兩腿算、其餘對外抓），
  // 但 fetchOneRaw 是依 source 派 adapter 的。兩邊對不起來時——source='derived'
  // 卻不是 spread——那條序列會走進沒有抓取路徑的分支。這條把兩個欄位綁死。
  it('source=derived 與 transform=spread 是同一組序列', () => {
    const derivedSource = SERIES_SPECS.filter(s => s.source === 'derived').map(s => s.seriesId).sort()
    const spreadTransform = SERIES_SPECS.filter(s => s.transform === 'spread').map(s => s.seriesId).sort()
    expect(derivedSource).toEqual(spreadTransform)
    expect(derivedSource.length).toBeGreaterThan(0)
  })

  it('non-spread series do not carry spreadOf', () => {
    for (const s of SERIES_SPECS.filter(x => x.transform !== 'spread'))
      expect(s.spreadOf, `${s.seriesId} is not a spread but has spreadOf`).toBeUndefined()
  })
  it('every series has a snapshot section', () => {
    for (const s of SERIES_SPECS)
      expect(['us-macro', 'rates-markets', 'us-equity', 'taiwan']).toContain(s.section)
  })
})

// flow/level 顯示語意的單一真相在 SeriesSpec.kind。以下三道守衛把「同一語意分散三處」
// 的漂移釘住——kind 標註本身、snapshot 的 delta 措辭表、shared 的關鍵數字卡清單。
describe('series kind（flow/level 顯示語意）', () => {
  it('every series carries a kind and only 值本身帶方向的量 is flow', () => {
    for (const s of SERIES_SPECS)
      expect(['level', 'flow'], `${s.seriesId} kind`).toContain(s.kind)
    expect(SERIES_SPECS.filter(s => s.kind === 'flow').map(s => s.seriesId).sort()).toEqual([
      'foreign-taifex-net',
      'taiex-institutional-net',
      'us-nonfarm-payrolls',
    ])
  })

  it('delta 措辭表（FLOW_PHRASES）的 key 與 kind === flow 的集合一致', () => {
    const flowIds = SERIES_SPECS.filter(s => s.kind === 'flow').map(s => s.seriesId).sort()
    expect(Object.keys(FLOW_PHRASES).sort()).toEqual(flowIds)
  })

  // shared 不能 import worker（依賴方向 worker → shared），兩份 kind 只能靠這道守衛防漂移。
  it('關鍵數字卡（KEY_NUMBER_SERIES）的 freshness 與 SERIES_SPECS 同序列一致', () => {
    // shared 不能依賴 worker、故 KEY_NUMBER_SERIES 刻意複製一份發布節奏；漂移會讓讀者面
    // 的落後標注與 LLM 讀到的 snapshot 不一致（同一天同一條序列、一邊標落後一邊沒標）。
    const freshnessById = new Map(SERIES_SPECS.map(s => [s.seriesId, s.freshness]))
    for (const spec of KEY_NUMBER_SERIES) {
      expect(freshnessById.has(spec.seriesId), `${spec.seriesId} 不在 SERIES_SPECS`).toBe(true)
      expect(spec.freshness, `${spec.seriesId} freshness 漂移`).toEqual(freshnessById.get(spec.seriesId))
    }
  })

  it('關鍵數字卡（KEY_NUMBER_SERIES）的 kind 與 SERIES_SPECS 同序列一致', () => {
    const kindById = new Map(SERIES_SPECS.map(s => [s.seriesId, s.kind]))
    for (const spec of KEY_NUMBER_SERIES) {
      expect(kindById.has(spec.seriesId), `${spec.seriesId} 不在 SERIES_SPECS`).toBe(true)
      expect(spec.kind, `${spec.seriesId} kind 漂移`).toBe(kindById.get(spec.seriesId))
    }
  })

  // 跨市場訊號組同樣把 kind 與 displayName 複製了一份到 shared。
  // kind 漂移會讓方向判反（flow 看正負、level 看差），label 漂移會讓報告裡的序列名
  // 與關鍵數字卡對不上，兩者都不會有任何 runtime 錯誤——只能靠這條擋。
  it('跨市場訊號組（CROSS_MARKET_SIGNAL_GROUPS）的 kind 與 label 與 SERIES_SPECS 一致', () => {
    const byId = new Map(SERIES_SPECS.map(s => [s.seriesId, s]))
    for (const group of CROSS_MARKET_SIGNAL_GROUPS) {
      for (const member of group.members) {
        const source = byId.get(member.seriesId)
        expect(source, `${group.id} 的 ${member.seriesId} 不在 SERIES_SPECS`).toBeDefined()
        expect(member.kind, `${member.seriesId} kind 漂移`).toBe(source?.kind)
        expect(member.label, `${member.seriesId} label 漂移`).toBe(source?.displayName)
      }
    }
  })
})
