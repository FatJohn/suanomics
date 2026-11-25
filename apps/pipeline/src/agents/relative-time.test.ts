import { describe, expect, it } from 'vitest'
import { relativeDayLabel } from './relative-time.js'

describe('relativeDayLabel', () => {
  it('同台北日 → 今日（UTC 凌晨仍是台北同日）', () => {
    expect(relativeDayLabel('2026-06-27T00:00:00Z', '2026-06-27')).toBe('今日')
  })
  it('美股盤後：UTC 6/26 晚=台北 6/27 → 今日（區域時差靠 publishedAt 自動處理）', () => {
    expect(relativeDayLabel('2026-06-26T21:53:08Z', '2026-06-27')).toBe('今日')
  })
  it('台股盤後：UTC 6/26 上午=台北 6/26 → 昨日', () => {
    expect(relativeDayLabel('2026-06-26T06:37:02Z', '2026-06-27')).toBe('昨日')
  })
  it('前 2 日 → 前日', () => {
    expect(relativeDayLabel('2026-06-25T06:00:00Z', '2026-06-27')).toBe('前日')
  })
  it('前 5 日 → 5天前', () => {
    expect(relativeDayLabel('2026-06-22T06:00:00Z', '2026-06-27')).toBe('5天前')
  })
  it('null / 非法 iso → 空字串', () => {
    expect(relativeDayLabel(null, '2026-06-27')).toBe('')
    expect(relativeDayLabel('not-a-date', '2026-06-27')).toBe('')
  })
  it('新聞日期晚於報告日（防禦）→ 空字串', () => {
    expect(relativeDayLabel('2026-06-28T06:00:00Z', '2026-06-27')).toBe('')
  })
})
