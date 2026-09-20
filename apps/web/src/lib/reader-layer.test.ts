import { describe, expect, it } from 'vitest'
import { carriedQuery, layerQuery, READER_LAYERS, resolveReaderLayer } from './reader-layer.js'

describe('resolveReaderLayer', () => {
  it('shouldDefaultToReportWhenAbsent', () => {
    expect(resolveReaderLayer(undefined)).toBe('report')
    expect(resolveReaderLayer(null)).toBe('report')
    expect(resolveReaderLayer('')).toBe('report')
  })
  it('shouldReadEvidence', () => {
    expect(resolveReaderLayer('evidence')).toBe('evidence')
  })
  it('shouldFallBackToReportOnUnknown', () => {
    expect(resolveReaderLayer('sources')).toBe('report')
    expect(resolveReaderLayer('EVIDENCE')).toBe('report')
  })
  // vue-router 會把重複的 query key 給成陣列；取第一個而不是整串比對
  it('shouldTakeFirstWhenRepeatedQueryKey', () => {
    expect(resolveReaderLayer(['evidence', 'report'])).toBe('evidence')
    expect(resolveReaderLayer([])).toBe('report')
  })
})

describe('layerQuery', () => {
  // report 是預設值：網址上不留 ?view=report，否則分享出去的連結長得像特例
  it('shouldOmitViewForDefaultLayer', () => {
    expect(layerQuery('report')).toEqual({ view: undefined })
  })
  it('shouldSetViewForEvidence', () => {
    expect(layerQuery('evidence')).toEqual({ view: 'evidence' })
  })
})

describe('reader layer order', () => {
  it('shouldListReportFirst', () => {
    expect(READER_LAYERS.map(l => l.id)).toEqual(['report', 'evidence'])
  })
})

// ★ 切層與換日共用的單一決定點。分岔的代價實測過：換日不帶 query 時，在佐證層按上一天
//   會被丟回報告層。
describe('carriedQuery', () => {
  it('不指定層別時沿用網址上現在那層（換日、fallback 連結走這條）', () => {
    expect(carriedQuery({ view: 'evidence' })).toEqual({ view: 'evidence' })
    expect(carriedQuery({})).toEqual({ view: undefined })
  })

  it('指定層別時就是切層', () => {
    expect(carriedQuery({ view: 'evidence' }, 'report')).toEqual({ view: undefined })
    expect(carriedQuery({}, 'evidence')).toEqual({ view: 'evidence' })
  })

  // ★ 負向對照：未知參數不帶過去。它在進站時留著（guard 不碰），但不該沿著導覽擴散
  it('未知的 query 不帶過去', () => {
    expect(carriedQuery({ view: 'evidence', foo: 'bar' })).toEqual({ view: 'evidence' })
  })

  // 非法的層別沿用時會被收斂成預設層——網址上不該留 ?view=bogus
  it('非法的層別沿用時收斂成預設層', () => {
    expect(carriedQuery({ view: 'bogus' })).toEqual({ view: undefined })
  })
})
