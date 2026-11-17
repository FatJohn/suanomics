import { describe, expect, it } from 'vitest'
import { confidenceLabel, directionLabel, groupByMonth, lectureNumbers, readingMinutes, weekdayLabel } from './handout'

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

describe('directionLabel', () => {
  it('四種方向各有中文字樣，不只靠顏色', () => {
    expect(directionLabel('positive')).toBe('正向')
    expect(directionLabel('negative')).toBe('負向')
    expect(directionLabel('mixed')).toBe('好壞參半')
    expect(directionLabel('uncertain')).toBe('不確定')
  })
})

describe('confidenceLabel', () => {
  it('信心程度轉成中文', () => {
    expect(confidenceLabel('high')).toBe('信心高')
    expect(confidenceLabel('medium')).toBe('信心中')
    expect(confidenceLabel('low')).toBe('信心低')
  })
})

describe('lectureNumbers', () => {
  it('由舊到新編回次，輸入順序不影響', () => {
    const n = lectureNumbers(['2026-11-17', '2026-11-09', '2026-11-13'])
    expect(n.get('2026-11-09')).toBe(1)
    expect(n.get('2026-11-13')).toBe(2)
    expect(n.get('2026-11-17')).toBe(3)
  })
})

describe('groupByMonth', () => {
  it('依年月分組並保留原順序', () => {
    const groups = groupByMonth([{ date: '2026-11-02' }, { date: '2026-11-01' }, { date: '2026-10-31' }])
    expect(groups.map(g => g.month)).toEqual(['2026 年 11 月', '2026 年 10 月'])
    expect(groups[0]?.items.map(i => i.date)).toEqual(['2026-11-02', '2026-11-01'])
    expect(groups[1]?.items.map(i => i.date)).toEqual(['2026-10-31'])
  })
})
