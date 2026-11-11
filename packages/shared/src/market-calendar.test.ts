import { describe, expect, it } from 'vitest'
import { CalendarEventSchema, isCompanyCalendarEvent } from './market-calendar.js'

describe('calendarEventSchema', () => {
  it('接受 derivatives-expiry，且不算公司事件', () => {
    const event = CalendarEventSchema.parse({
      date: '2027-06-17',
      title: '美股四巫日（2027-06 季度期貨與選擇權到期）',
      region: 'US',
      importance: 'medium',
      category: 'derivatives-expiry',
    })
    expect(event.category).toBe('derivatives-expiry')
    expect(isCompanyCalendarEvent(event)).toBe(false)
  })
})
