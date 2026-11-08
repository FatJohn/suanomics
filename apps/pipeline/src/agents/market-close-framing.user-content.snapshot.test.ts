import { describe, expect, it } from 'vitest'
import { buildMarketCloseFraming } from './market-close-framing.js'

// Characterization test：凍結 buildMarketCloseFraming 每個分支的輸出，供後續把
// 標題與說明句搬進 prompts/ 之後比對逐字未變。
describe('market-close-framing user content snapshot', () => {
  it('同台北日 → 今日', () => {
    expect(buildMarketCloseFraming('2026-06-27', '2026-06-27')).toMatchSnapshot()
  })

  it('前一台北日 → 昨日、資料日去除前導 0', () => {
    expect(buildMarketCloseFraming('2026-01-05', '2026-01-06')).toMatchSnapshot()
  })

  it('前兩日 → 前日', () => {
    expect(buildMarketCloseFraming('2026-06-25', '2026-06-27')).toMatchSnapshot()
  })

  it('前五日 → N天前', () => {
    expect(buildMarketCloseFraming('2026-06-22', '2026-06-27')).toMatchSnapshot()
  })

  it('taiexCloseDate 為 null → 空字串（degrade）', () => {
    expect(buildMarketCloseFraming(null, '2026-06-27')).toMatchSnapshot()
  })

  it('收盤日晚於報告日（防禦）→ 空字串', () => {
    expect(buildMarketCloseFraming('2026-06-28', '2026-06-27')).toMatchSnapshot()
  })
})
