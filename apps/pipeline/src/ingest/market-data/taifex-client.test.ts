import { describe, expect, it } from 'vitest'
import { parseTaifexContracts } from './taifex-client.js'

const CSV_HEADER = '日期,商品名稱,身份別,多方交易口數,多方交易契約金額(千元),空方交易口數,空方交易契約金額(千元),多空交易口數淨額,多空交易契約金額淨額(千元),多方未平倉口數,多方未平倉契約金額(千元),空方未平倉口數,空方未平倉契約金額(千元),多空未平倉口數淨額,多空未平倉契約金額淨額(千元)'

// 實測 sample（2026/07/06+07、含自營商/投信/外資及陸資三列）
const SAMPLE_CSV = [
  CSV_HEADER,
  '2026/07/06,臺股期貨,自營商,4071,38334094,4491,42319405,-420,-3985311,7201,67685444,4531,42610411,2670,25075033',
  '2026/07/06,臺股期貨,投信,1149,10841142,1108,10411332,41,429810,73263,686887640,6009,56386795,67254,630500845',
  '2026/07/06,臺股期貨,外資及陸資,48892,460442236,48000,452132325,892,8309911,6297,59069965,86384,810086464,-80087,-751016499',
  '2026/07/07,臺股期貨,自營商,9599,89216796,8725,80801239,874,8415557,8255,75651750,4462,40918141,3793,34733609',
  '2026/07/07,臺股期貨,投信,4144,38207227,3211,29580244,933,8626983,74373,679835781,6186,56594303,68187,623241478',
  '2026/07/07,臺股期貨,外資及陸資,70707,658601916,70618,658215974,89,385942,6562,60012723,86604,791865413,-80042,-731852690',
].join('\n')

describe('parseTaifexContracts', () => {
  it('extracts 外資及陸資 臺股期貨 未平倉多空淨額口數 per trading day', () => {
    expect(parseTaifexContracts(SAMPLE_CSV)).toEqual([
      { date: '2026-07-06', value: -80087 },
      { date: '2026-07-07', value: -80042 },
    ])
  })

  it('filters out 自營商 and 投信 rows', () => {
    const points = parseTaifexContracts(SAMPLE_CSV)
    expect(points).toHaveLength(2)
    expect(points.map(p => p.value)).not.toContain(2670) // 自營商未平倉淨額
    expect(points.map(p => p.value)).not.toContain(67254) // 投信未平倉淨額
  })

  it('returns empty for non-trading-day HTML response', () => {
    const html = '<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01//EN">\n<html><body>查無資料</body></html>'
    expect(parseTaifexContracts(html)).toEqual([])
  })

  it('returns empty when target column name is absent (header changed)', () => {
    const csv = ['日期,商品名稱,身份別,多方交易口數', '2026/07/07,臺股期貨,外資及陸資,70707'].join('\n')
    expect(parseTaifexContracts(csv)).toEqual([])
  })

  it('trims whitespace on 商品名稱/身份別 before matching（防 TAIFEX 欄位補空白靜默濾掉整列）', () => {
    const csv = [
      CSV_HEADER,
      '2026/07/07, 臺股期貨 , 外資及陸資 ,70707,658601916,70618,658215974,89,385942,6562,60012723,86604,791865413,-80042,-731852690',
    ].join('\n')
    expect(parseTaifexContracts(csv)).toEqual([
      { date: '2026-07-07', value: -80042 },
    ])
  })

  it('skips 盤中未揭露列（多方/空方未平倉口數皆為 0）、只保留已結算列', () => {
    // 實測 2026/07/08 盤中（16:15 結算揭露前）：成交量有值、但三個未平倉欄全為 0（未揭露、非淨部位歸零）
    const csv = [
      CSV_HEADER,
      '2026/07/08,臺股期貨,外資及陸資,80320,731920919,81515,743087474,-1195,-11166555,0,0,0,0,0,0',
      '2026/07/07,臺股期貨,外資及陸資,70707,658601916,70618,658215974,89,385942,6562,60012723,86604,791865413,-80042,-731852690',
    ].join('\n')
    expect(parseTaifexContracts(csv)).toEqual([
      { date: '2026-07-07', value: -80042 },
    ])
  })
})
