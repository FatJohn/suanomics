import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { mergeCalendarEvents, parseFedCalendar } from './fed-calendar.js'

const fixture = JSON.parse(readFileSync(new URL('__fixtures__/fed-calendar.json', import.meta.url), 'utf-8')) as unknown

describe('parseFedCalendar', () => {
  it('只取今天起的 FOMC 會議，不含 minutes 與演說', () => {
    expect(parseFedCalendar(fixture, '2026-11-08')).toEqual([
      { date: '2026-12-09', title: 'FOMC 利率決策', region: 'US', importance: 'high', category: 'macro' },
    ])
  })
  it('days 是區間時取會議最後一天，個位數補零', () => {
    const body = { events: [{ type: 'FOMC', title: 'FOMC Meeting', month: '2027-01', days: '5-6' }] }
    expect(parseFedCalendar(body, '2026-11-08')[0]?.date).toBe('2027-01-06')
  })
  it('回應不是預期形狀時回空陣列', () => {
    expect(parseFedCalendar({ nope: true }, '2026-11-08')).toEqual([])
  })
})

describe('mergeCalendarEvents', () => {
  const macro = { region: 'US' as const, importance: 'high' as const }
  it('同日已有手動維護的 FOMC 時不重複加入', () => {
    const manual = [{ ...macro, date: '2026-12-09', title: 'FOMC 利率決策（含經濟預測）' }]
    const fed = [{ ...macro, date: '2026-12-09', title: 'FOMC 利率決策' }, { ...macro, date: '2027-01-27', title: 'FOMC 利率決策' }]
    expect(mergeCalendarEvents(manual, fed).map(e => e.date)).toEqual(['2026-12-09', '2027-01-27'])
    expect(mergeCalendarEvents(manual, fed)[0]?.title).toContain('含經濟預測')
  })
})
