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
})
