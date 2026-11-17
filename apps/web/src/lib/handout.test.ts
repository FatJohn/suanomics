import { describe, expect, it } from 'vitest'
import { readingMinutes, weekdayLabel } from './handout'

describe('weekdayLabel', () => {
  it('依日曆日期回傳星期，不受執行環境時區影響', () => {
    expect(weekdayLabel('2026-11-17')).toBe('二')
    expect(weekdayLabel('2026-11-15')).toBe('日')
    expect(weekdayLabel('2026-11-21')).toBe('六')
  })
})

describe('readingMinutes', () => {
  it('以每分鐘 500 字無條件進位', () => {
    expect(readingMinutes(['字'.repeat(500)])).toBe(1)
    expect(readingMinutes(['字'.repeat(501)])).toBe(2)
    expect(readingMinutes(['字'.repeat(300), '字'.repeat(300)])).toBe(2)
  })

  it('空白與 markdown 標記不算字數，至少 1 分鐘', () => {
    expect(readingMinutes(['**  **', ''])).toBe(1)
    expect(readingMinutes([`**${'字'.repeat(500)}**\n\n`])).toBe(1)
  })
})
