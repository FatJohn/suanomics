import { describe, expect, it } from 'vitest'
import { filterRecentEntries } from './recency.js'

const now = new Date('2026-11-08T00:00:00Z')
const entry = (publishedAt: Date | null) => ({ publishedAt })

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
