import { describe, expect, it } from 'vitest'
import { taipeiDateOf } from './report-date.js'

describe('taipeiDateOf', () => {
  it('returns the Taipei calendar day, not the UTC one', () => {
    // 若排程在 21:10 UTC 觸發：那是台北隔日 05:10。這一格就是整個重構的理由。
    expect(taipeiDateOf(new Date('2026-08-05T21:10:00Z'))).toBe('2026-08-06')
  })

  it('flips at 16:00 UTC, not at midnight UTC', () => {
    expect(taipeiDateOf(new Date('2026-08-05T15:59:59Z'))).toBe('2026-08-05')
    expect(taipeiDateOf(new Date('2026-08-05T16:00:00Z'))).toBe('2026-08-06')
  })

  it('zero-pads month and day', () => {
    expect(taipeiDateOf(new Date('2026-01-01T12:00:00Z'))).toBe('2026-01-01')
    expect(taipeiDateOf(new Date('2026-01-01T16:00:00Z'))).toBe('2026-01-02')
  })

  it('crosses the year boundary in Taipei terms', () => {
    expect(taipeiDateOf(new Date('2025-12-31T16:00:00Z'))).toBe('2026-01-01')
  })

  // ops.ts / market.ts / snapshot.ts 的三份行內實作改為引用本函式，
  // 「行為不變」要用等價證明，不是靠 diff 看起來一樣。
  it('matches the inline Intl implementation it replaces', () => {
    const inline = (d: Date): string =>
      new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(d)
    const samples = [
      '2026-08-05T21:10:00Z',
      '2026-08-05T15:59:59Z',
      '2026-08-05T16:00:00Z',
      '2026-01-01T00:00:00Z',
      '2025-12-31T16:00:00Z',
      '2026-02-28T16:00:00Z',
      '2024-02-29T16:00:00Z',
    ]
    for (const iso of samples) {
      const d = new Date(iso)
      expect(taipeiDateOf(d)).toBe(inline(d))
    }
  })
})
