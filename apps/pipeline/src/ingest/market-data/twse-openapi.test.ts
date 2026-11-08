import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseMarginTotals, parseMiIndex, parseQfiiCategory, topVolumeCompanies } from './twse-openapi.js'

const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`__fixtures__/${name}`, import.meta.url), 'utf-8'))

describe('parseMiIndex', () => {
  it('只取關注指數，民國日期轉 ISO、未列入的指數略過', () => {
    const out = parseMiIndex(fixture('twse-mi-index.json') as unknown[])
    expect(out.map(p => p.seriesId).sort()).toEqual(['twse-index-electronics', 'twse-index-financial', 'twse-index-semiconductor', 'twse-index-shipping', 'twse-index-taiex'])
    expect(out.find(p => p.seriesId === 'twse-index-semiconductor')).toEqual({ seriesId: 'twse-index-semiconductor', date: '2026-11-06', value: 1328.81 })
  })
  it('收盤不是數字的列略過', () => {
    expect(parseMiIndex([{ 日期: '1151106', 指數: '半導體類指數', 收盤指數: '--' }])).toEqual([])
  })
})

describe('parseQfiiCategory', () => {
  it('回應沒有日期，用呼叫端給的交易日', () => {
    const out = parseQfiiCategory(fixture('twse-mi-qfiis-cat.json') as unknown[], '2026-11-06')
    expect(out[0]).toEqual({ seriesId: 'twse-qfii-pct:ETF', date: '2026-11-06', value: 1.1 })
    expect(out).toHaveLength(3)
  })
})

describe('parseMarginTotals', () => {
  it('加總全市場融資與融券今日餘額，空值當 0', () => {
    const rows = [
      { 融資今日餘額: '1,000', 融券今日餘額: '' },
      { 融資今日餘額: '500', 融券今日餘額: '20' },
    ]
    expect(parseMarginTotals(rows, '2026-11-06')).toEqual([
      { seriesId: 'twse-margin-lots-total', date: '2026-11-06', value: 1500 },
      { seriesId: 'twse-short-lots-total', date: '2026-11-06', value: 20 },
    ])
  })
  it('空回應或欄位改名時不產生 0，避免覆蓋當日正確值', () => {
    expect(parseMarginTotals([], '2026-11-06')).toEqual([])
    expect(parseMarginTotals([{ 融資餘額: '1' }], '2026-11-06')).toEqual([])
  })
  it('真實回應的欄位名對得上', () => {
    const out = parseMarginTotals(fixture('twse-mi-margn-openapi.json') as unknown[], '2026-11-06')
    expect(out[0]?.value).toBeGreaterThan(0)
  })
})

describe('topVolumeCompanies', () => {
  it('上市上櫃合併取成交量前 N，排除 ETF 與權證', () => {
    const twse = [
      { Code: '2330', Name: '台積電', TradeVolume: '100' },
      { Code: '0050', Name: '元大台灣50', TradeVolume: '999' },
      { Code: '00400A', Name: '主動', TradeVolume: '999' },
    ]
    const tpex = [
      { SecuritiesCompanyCode: '6488', CompanyName: '環球晶', TradingShares: '200' },
      { SecuritiesCompanyCode: '700001', CompanyName: '權證', TradingShares: '999' },
    ]
    expect(topVolumeCompanies(twse, tpex, 1)).toEqual([{ code: '6488', name: '環球晶' }])
    expect(topVolumeCompanies(twse, tpex, 5).map(c => c.code)).toEqual(['6488', '2330'])
  })
  it('真實回應的欄位名對得上', () => {
    const out = topVolumeCompanies(fixture('twse-stock-day-all.json') as unknown[], fixture('tpex-daily-close.json') as unknown[], 50)
    for (const company of out)
      expect(company.code).toMatch(/^[1-9]\d{3}$/)
  })
})
