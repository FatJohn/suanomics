import type { MarketRules } from './derivatives-expiry.js'
import { HOLIDAY_COVERAGE_END } from '@suanomics/shared'
import { describe, expect, it } from 'vitest'
import { deriveExpiryEvents, thirdWeekdayOfMonth, twIndexFuturesSettlement, usQuadWitching } from './derivatives-expiry.js'

// 休市表涵蓋終點的隔年：年度補表後跟著往後移，涵蓋範圍外的案例不會因為補表變紅。
const BEYOND = Number(HOLIDAY_COVERAGE_END.slice(0, 4)) + 1

// 用指定休市日組出規則，給休市表涵蓋範圍以前的官方實例用（2023、2026 上半年）。
function rulesWith(holidays: string[], coverageStart: string, coverageEnd: string): MarketRules {
  const set = new Set(holidays)
  return {
    coverageStart,
    coverageEnd,
    isTradingDay: (d) => {
      const dow = new Date(`${d}T00:00:00Z`).getUTCDay()
      return dow !== 0 && dow !== 6 && !set.has(d)
    },
  }
}

function shiftIso(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

describe('thirdWeekdayOfMonth', () => {
  it('第三個週三與第三個週五', () => {
    expect(thirdWeekdayOfMonth(2027, 6, 3)).toBe('2027-06-16')
    expect(thirdWeekdayOfMonth(2027, 6, 5)).toBe('2027-06-18')
    // 月初就是目標星期幾
    expect(thirdWeekdayOfMonth(2027, 9, 3)).toBe('2027-09-15')
    expect(thirdWeekdayOfMonth(2026, 5, 5)).toBe('2026-05-15')
  })
})

describe('twIndexFuturesSettlement', () => {
  // 期交所「指數期貨最後結算價」TX 列（futIndxFSP，2026-11-11 查）。
  it('休市表涵蓋範圍內的官方結算日', () => {
    expect(twIndexFuturesSettlement(2026, 8)).toBe('2026-08-19')
    expect(twIndexFuturesSettlement(2026, 9)).toBe('2026-09-16')
    expect(twIndexFuturesSettlement(2026, 10)).toBe('2026-10-21')
  })

  it('第三個週三遇休市順延到次一營業日：2023-01 春節（官方 2023-01-30）', () => {
    const rules = rulesWith(
      ['2023-01-18', '2023-01-19', '2023-01-20', '2023-01-23', '2023-01-24', '2023-01-25', '2023-01-26', '2023-01-27'],
      '2023-01-01',
      '2023-12-31',
    )
    expect(twIndexFuturesSettlement(2023, 1, rules)).toBe('2023-01-30')
  })

  it('第三個週三遇休市順延到次一營業日：2026-02 春節（官方 2026-02-23）', () => {
    const rules = rulesWith(
      ['2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20'],
      '2026-01-01',
      '2026-12-31',
    )
    expect(twIndexFuturesSettlement(2026, 2, rules)).toBe('2026-02-23')
  })

  // 2027 台股休市表是暫定的（TW_HOLIDAYS_PROVISIONAL_UNTIL）；這筆跟著 09-15 中秋節走。
  it('2027-09 第三個週三 09-15 中秋節休市，順延到 09-16（依賴暫定休市表）', () => {
    expect(twIndexFuturesSettlement(2027, 9)).toBe('2027-09-16')
  })

  it('超出休市表涵蓋範圍回 null，不產出未經調整的日期', () => {
    expect(twIndexFuturesSettlement(2026, 6)).toBeNull()
    // 2026-07 第三個週三 07-15 在涵蓋起點 07-21 之前：起點往前挪就會產出未經休市核對的日期。
    expect(twIndexFuturesSettlement(2026, 7)).toBeNull()
    expect(twIndexFuturesSettlement(BEYOND, 1)).toBeNull()
  })

  it('順延途中走出涵蓋範圍也回 null', () => {
    const rules = rulesWith(['2027-12-15'], '2027-01-01', '2027-12-15')
    expect(twIndexFuturesSettlement(2027, 12, rules)).toBeNull()
  })
})

describe('usQuadWitching', () => {
  it('第三個週五', () => {
    expect(usQuadWitching(2026, 9)).toBe('2026-09-18')
    expect(usQuadWitching(2026, 12)).toBe('2026-12-18')
    expect(usQuadWitching(2027, 3)).toBe('2027-03-19')
    expect(usQuadWitching(2027, 9)).toBe('2027-09-17')
    expect(usQuadWitching(2027, 12)).toBe('2027-12-17')
  })

  it('2027-06 第三個週五 06-18 是 Juneteenth 補假（NYSE 已公告），四巫日為前一交易日 06-17', () => {
    expect(usQuadWitching(2027, 6)).toBe('2027-06-17')
  })

  it('2026-06 第三個週五 06-19 Juneteenth，提前到 06-18（注入休市日）', () => {
    const rules = rulesWith(['2026-06-19'], '2026-01-01', '2026-12-31')
    expect(usQuadWitching(2026, 6, rules)).toBe('2026-06-18')
  })

  it('非季月不是四巫日', () => {
    expect(() => usQuadWitching(2027, 5)).toThrow()
  })

  it('超出休市表涵蓋範圍回 null', () => {
    expect(usQuadWitching(2026, 6)).toBeNull()
    expect(usQuadWitching(BEYOND, 3)).toBeNull()
  })
})

describe('deriveExpiryEvents', () => {
  it('視窗內產出兩類事件，category 為 derivatives-expiry，依日期排序', () => {
    const { events, uncovered } = deriveExpiryEvents('2027-06-14', '2027-06-21')
    expect(uncovered).toEqual([])
    expect(events).toEqual([
      { date: '2027-06-16', title: '台指期 2027-06 月契約最後結算日', region: 'TW', importance: 'medium', category: 'derivatives-expiry' },
      { date: '2027-06-17', title: '美股四巫日（2027-06 季度期貨與選擇權到期）', region: 'US', importance: 'medium', category: 'derivatives-expiry' },
    ])
  })

  it('非季月只有台指期結算', () => {
    const { events } = deriveExpiryEvents('2027-05-17', '2027-05-24')
    expect(events.map(e => e.date)).toEqual(['2027-05-19'])
  })

  it('跨月視窗兩個月都算到', () => {
    const { events } = deriveExpiryEvents('2026-09-15', '2026-10-22')
    expect(events.map(e => e.date)).toEqual(['2026-09-16', '2026-09-18', '2026-10-21'])
  })

  it('視窗外的事件不帶', () => {
    expect(deriveExpiryEvents('2027-06-01', '2027-06-07').events).toEqual([])
  })

  it('超出休市表涵蓋範圍：不產出事件，uncovered 列出未經調整的候選日', () => {
    const tw = thirdWeekdayOfMonth(BEYOND, 3, 3)
    const us = thirdWeekdayOfMonth(BEYOND, 3, 5)
    const { events, uncovered } = deriveExpiryEvents(tw, us)
    expect(events).toEqual([])
    expect(uncovered).toEqual([
      { title: `台指期 ${BEYOND}-03 月契約最後結算日`, rawDate: tw },
      { title: `美股四巫日（${BEYOND}-03 季度期貨與選擇權到期）`, rawDate: us },
    ])
  })

  // 涵蓋範圍外不知道會順延幾天：台指期往後順延、四巫日往前提前，規則日在視窗外也可能落進來。
  it('超出涵蓋範圍時，規則日在視窗前的台指期、在視窗後的四巫日也列進 uncovered', () => {
    const tw = thirdWeekdayOfMonth(BEYOND, 3, 3)
    const us = thirdWeekdayOfMonth(BEYOND, 3, 5)
    const twOnly = deriveExpiryEvents(shiftIso(tw, 1), shiftIso(tw, 1))
    expect(twOnly.uncovered.map(u => u.rawDate)).toContain(tw)
    const usOnly = deriveExpiryEvents(shiftIso(us, -1), shiftIso(us, -1))
    expect(usOnly.uncovered.map(u => u.rawDate)).toContain(us)
  })

  it('涵蓋範圍內規則日在視窗外、調整後也不進視窗的，不列 uncovered 也不產出', () => {
    expect(deriveExpiryEvents('2027-06-18', '2027-06-20')).toEqual({ events: [], uncovered: [] })
  })
})
