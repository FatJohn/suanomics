import { describe, expect, it } from 'vitest'
import { buildMarketCloseFraming } from './market-close-framing.js'

describe('buildMarketCloseFraming', () => {
  it('台股前一台北日 → 昨日 + 資料日 M/DD + 其他市場指引句', () => {
    const block = buildMarketCloseFraming('2026-06-26', '2026-06-27')
    expect(block).toContain('市場收盤時間框架')
    expect(block).toContain('台股（加權指數）最近收盤：昨日（資料日 6/26）')
    expect(block).toContain('其他市場')
    expect(block).toContain('發布時間')
  })

  it('台股同台北日 → 今日', () => {
    expect(buildMarketCloseFraming('2026-06-27', '2026-06-27')).toContain('最近收盤：今日')
  })

  it('台股前兩日 → 前日', () => {
    expect(buildMarketCloseFraming('2026-06-25', '2026-06-27')).toContain('最近收盤：前日')
  })

  it('taiexCloseDate 為 null → 空字串（degrade）', () => {
    expect(buildMarketCloseFraming(null, '2026-06-27')).toBe('')
  })

  it('收盤日晚於報告日（防禦）→ 空字串', () => {
    expect(buildMarketCloseFraming('2026-06-28', '2026-06-27')).toBe('')
  })

  // #113 G1：11/26 報告的加權指數停在 11/24，11/25 大跌沒有進報告，模型把 11/24 的大漲寫成最新行情。
  it('資料日早於前一交易日 → 標出前一交易日收盤缺資料、禁止當最新行情與放進標題', () => {
    const block = buildMarketCloseFraming('2026-11-24', '2026-11-26')
    expect(block).toContain('前一交易日（11/25）的台股收盤缺資料')
    expect(block).toContain('11/24 的加權指數不是最新行情')
    expect(block).toContain('不得放進標題')
  })

  it('資料日就是前一交易日 → 不標缺資料', () => {
    expect(buildMarketCloseFraming('2026-11-25', '2026-11-26')).not.toContain('缺資料')
  })

  it('跨週末：週一報告、資料日是上週五 → 不標缺資料', () => {
    expect(buildMarketCloseFraming('2026-11-27', '2026-11-30')).not.toContain('缺資料')
  })

  it('報告日在休市表涵蓋窗外 → 不判定缺資料（交易日曆不可信）', () => {
    expect(buildMarketCloseFraming('2026-06-22', '2026-06-27')).not.toContain('缺資料')
    expect(buildMarketCloseFraming('2027-12-29', '2028-01-04')).not.toContain('缺資料')
  })

  it('前一交易日落在休市表涵蓋起點之前 → 不判定缺資料', () => {
    expect(buildMarketCloseFraming('2026-07-17', '2026-07-21')).not.toContain('缺資料')
  })
})
