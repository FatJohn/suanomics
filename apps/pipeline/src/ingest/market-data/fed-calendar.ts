import type { CalendarEvent } from '@suanomics/shared'

export const FED_CALENDAR_URL = 'https://www.federalreserve.gov/json/calendar.json'

const FOMC_DECISION_TITLE = 'FOMC 利率決策'

interface FedEvent {
  type?: unknown
  title?: unknown
  month?: unknown
  days?: unknown
}

export function parseFedCalendar(body: unknown, today: string): CalendarEvent[] {
  const events = (body as { events?: unknown } | null)?.events
  if (!Array.isArray(events))
    return []
  return (events as FedEvent[]).flatMap((event) => {
    if (event.type !== 'FOMC' || typeof event.title !== 'string' || !/meeting/i.test(event.title))
      return []
    if (typeof event.month !== 'string' || typeof event.days !== 'string')
      return []
    // 決策在會議最後一天公布，days 若是區間取尾端。
    const lastDay = event.days.split('-').at(-1)?.trim().padStart(2, '0')
    const date = `${event.month}-${lastDay}`
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < today)
      return []
    return [{ date, title: FOMC_DECISION_TITLE, region: 'US' as const, importance: 'high' as const, category: 'macro' as const }]
  })
}

// 手動維護的條目帶「含經濟預測」等 Fed JSON 沒有的資訊，同日以手動為準；
// Fed JSON 補的是手動表還沒涵蓋到的日期。
export function mergeCalendarEvents(manual: readonly CalendarEvent[], fed: readonly CalendarEvent[]): CalendarEvent[] {
  const manualFomcDates = new Set(manual.filter(e => e.title.includes('FOMC')).map(e => e.date))
  return [...manual, ...fed.filter(e => !manualFomcDates.has(e.date))]
}
