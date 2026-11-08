import { describe, expect, it } from 'vitest'
import {
  classifyPublicationDay,
  daysUntilHolidayCoverageExhausted,
  HOLIDAY_COVERAGE_END,
  HOLIDAY_FRESHNESS_MIN_DAYS,
  TW_MARKET_HOLIDAYS,
  US_MARKET_HOLIDAYS,
} from './market-holidays.js'

describe('classifyPublicationDay（星期分類）', () => {
  it('週六回 skip/saturday', () => {
    expect(classifyPublicationDay('2026-07-11')).toEqual({ kind: 'skip', reason: 'saturday' })
  })
  it('週日回 weekly-recap', () => {
    expect(classifyPublicationDay('2026-07-12')).toEqual({ kind: 'weekly-recap' })
  })
  it('平日回 weekday-brief', () => {
    expect(classifyPublicationDay('2026-07-10')).toEqual({ kind: 'weekday-brief' }) // 週五
    expect(classifyPublicationDay('2026-07-13')).toEqual({ kind: 'weekday-brief' }) // 週一
  })
})

describe('classifyPublicationDay（假日規則：台美都休才 skip）', () => {
  it('台股假日但前夜美股有開 → 照出', () => {
    // 規則看的是 D-1 是否美股交易日。2026-10-09（五）國慶補假台股休、前夜 10-08（四）美股有開 → 照出。
    expect(classifyPublicationDay('2026-10-09')).toEqual({ kind: 'weekday-brief' })
  })
  it('美股假日但台股有開 → 照出', () => {
    // 2026-11-27（五）：台股開、前夜 11-26 感恩節美股休 → 仍照出（台股 D 有開就出）
    expect(classifyPublicationDay('2026-11-27')).toEqual({ kind: 'weekday-brief' })
  })
  it('台股休且前夜無美股交易 → skip/holiday-no-material', () => {
    // 2026-09-28（一）教師節：台股休、前夜=09-27 週日美股無交易 → skip。
    expect(classifyPublicationDay('2026-09-28')).toEqual({ kind: 'skip', reason: 'holiday-no-material' })
  })
  it('台股假日但前夜美股僅早收盤（算開市）→ 照出', () => {
    // 2026-12-25（五）行憲紀念日台股休、前夜 12-24 美股僅早收盤（早收算開市、不列假日表）→ 不 skip。
    expect(classifyPublicationDay('2026-12-25')).toEqual({ kind: 'weekday-brief' })
  })
  it('跨年界日期正常運作', () => {
    expect(classifyPublicationDay('2027-01-04')).toEqual({ kind: 'weekday-brief' }) // 週一、台股開
  })
})

describe('假日表 time-bomb 守門', () => {
  it('mock 今天在 coverage end 前 29 天 → 低於門檻', () => {
    const end = new Date(`${HOLIDAY_COVERAGE_END}T00:00:00Z`)
    const now29 = new Date(end.getTime() - 29 * 86_400_000)
    expect(daysUntilHolidayCoverageExhausted(now29)).toBeLessThan(HOLIDAY_FRESHNESS_MIN_DAYS)
  })
  it('mock 今天在 coverage end 前 31 天 → 高於門檻', () => {
    const end = new Date(`${HOLIDAY_COVERAGE_END}T00:00:00Z`)
    const now31 = new Date(end.getTime() - 31 * 86_400_000)
    expect(daysUntilHolidayCoverageExhausted(now31)).toBeGreaterThanOrEqual(HOLIDAY_FRESHNESS_MIN_DAYS)
  })
  // 刻意用真實 new Date()：種子剩不足 30 天時本測試自動變紅、逼人年度更新假日表。
  // 這是預期設計、非 flaky——請勿因為它「有一天會紅」就移除（比照 econ-calendar 前例）。
  it('假日表須覆蓋未來至少 HOLIDAY_FRESHNESS_MIN_DAYS 天', () => {
    const days = daysUntilHolidayCoverageExhausted(new Date())
    expect(
      days,
      `假日表涵蓋終點 ${HOLIDAY_COVERAGE_END} 距今僅 ${days} 天 < ${HOLIDAY_FRESHNESS_MIN_DAYS}；`
      + `請依 TWSE/NYSE 官方公告更新 packages/shared/src/market-holidays.ts`,
    ).toBeGreaterThanOrEqual(HOLIDAY_FRESHNESS_MIN_DAYS)
  })
  it('假日表日期格式與非週末 sanity', () => {
    for (const d of [...TW_MARKET_HOLIDAYS, ...US_MARKET_HOLIDAYS]) {
      expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      const dow = new Date(`${d}T00:00:00Z`).getUTCDay()
      expect(dow, `${d} 是週末、不應列入假日表`).toBeGreaterThanOrEqual(1)
      expect(dow).toBeLessThanOrEqual(5)
    }
  })
})
