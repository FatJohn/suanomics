import { describe, expect, it, vi } from 'vitest'
import { loadReaderView, readerRouteDate } from './reader-load.js'

function targets() {
  return { fetchBriefByDate: vi.fn(), fetchDailyBrief: vi.fn(), fetchKeyNumbers: vi.fn() }
}

describe('readerRouteDate', () => {
  it('字串照用、空字串與陣列與 undefined 都當成沒有日期', () => {
    expect(readerRouteDate('2026-08-15')).toBe('2026-08-15')
    expect(readerRouteDate('')).toBeUndefined()
    expect(readerRouteDate(['2026-08-15'])).toBeUndefined()
    expect(readerRouteDate(undefined)).toBeUndefined()
  })
})

describe('loadReaderView', () => {
  // 正文與關鍵數字並排顯示，時間基準不同就是這裡要防的病。這條守的是
  // 「兩個 store 拿到同一個日期」——把 fetchKeyNumbers 的參數拿掉就會紅。
  it('/d/:date：brief 與關鍵數字拿同一個日期', () => {
    const t = targets()
    loadReaderView(t, '2026-08-15')
    expect(t.fetchBriefByDate).toHaveBeenCalledWith('2026-08-15')
    expect(t.fetchKeyNumbers).toHaveBeenCalledWith('2026-08-15')
    expect(t.fetchDailyBrief).not.toHaveBeenCalled()
  })

  it('/（無日期）：走今日 brief，關鍵數字不帶日期（維持盤中更新）', () => {
    const t = targets()
    loadReaderView(t, undefined)
    expect(t.fetchDailyBrief).toHaveBeenCalled()
    expect(t.fetchKeyNumbers).toHaveBeenCalledWith(undefined)
    expect(t.fetchBriefByDate).not.toHaveBeenCalled()
  })
})
