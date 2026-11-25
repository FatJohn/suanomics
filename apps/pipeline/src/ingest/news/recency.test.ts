import { describe, expect, it } from 'vitest'
import { FEED_WINDOW_HOURS, filterRecentEntries } from './recency.js'

const now = new Date('2026-11-08T00:00:00Z')
const entry = (publishedAt: Date | null) => ({ publishedAt })

describe('fEED_WINDOW_HOURS', () => {
  // 窗要大於最長休市（2026 春節 02-12 到 02-22，共 11 天），非交易日那幾次抓取失敗時才補得回來。
  it('涵蓋最長連休', () => {
    expect(FEED_WINDOW_HOURS).toBeGreaterThanOrEqual(11 * 24)
  })
})

describe('filterRecentEntries', () => {
  it('窗外的舊聞不收，官方 feed 動輒數百則歷史稿', () => {
    const inside = entry(new Date('2026-11-07T00:00:00Z'))
    const outside = entry(new Date('2026-11-05T00:00:00Z'))
    expect(filterRecentEntries([inside, outside], now, 48)).toEqual([inside])
  })
  it('沒有發布時間的留下，由 externalId 去重', () => {
    const undated = entry(null)
    expect(filterRecentEntries([undated], now, 48)).toEqual([undated])
  })
})
