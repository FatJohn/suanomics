import { describe, expect, it } from 'vitest'
import { formatBriefDate, formatMonthDay } from './format-date.js'

describe('formatBriefDate', () => {
  it('shouldFormatIsoToZhDate', () => {
    // 2026-06-14 為週日
    expect(formatBriefDate('2026-06-14')).toBe('2026 年 6 月 14 日 · 週日')
  })
  it('shouldHandleWeekday', () => {
    // 2026-06-15 為週一
    expect(formatBriefDate('2026-06-15')).toBe('2026 年 6 月 15 日 · 週一')
  })
  it('shouldReturnRawOnInvalid', () => {
    expect(formatBriefDate('not-a-date')).toBe('not-a-date')
  })
})

describe('formatMonthDay', () => {
  it('shouldReturnZeroPaddedMonthDay', () => {
    expect(formatMonthDay('2026-06-13')).toBe('06/13')
  })
  it('shouldReturnInputWhenMalformed', () => {
    expect(formatMonthDay('nope')).toBe('nope')
  })
})
