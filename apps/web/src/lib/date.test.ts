import { describe, expect, it } from 'vitest'
import { formatTaipeiDate } from './date'

describe('formatTaipeiDate', () => {
  it('用台北日期，開盤前發布的新聞不會顯示成前一天', () => {
    expect(formatTaipeiDate(new Date('2026-11-08T23:30:00Z'))).toBe('2026-11-09')
  })
})
