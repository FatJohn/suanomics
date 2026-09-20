import { describe, expect, it } from 'vitest'
import { weekBounds } from './report-day.js'

describe('weekBounds', () => {
  it('週日回傳該週週一到週五', () => {
    // 2026-07-12（日）→ 週一 2026-07-06、週五 2026-07-10
    expect(weekBounds('2026-07-12')).toEqual({ start: '2026-07-06', end: '2026-07-10' })
  })
})
