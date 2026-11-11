import { describe, expect, it } from 'vitest'
import { previousTradingDay } from './market-freshness.js'
import {
  classifyPublicationDay,
  daysUntilHolidayCoverageExhausted,
  HOLIDAY_COVERAGE_END,
  HOLIDAY_COVERAGE_START,
  HOLIDAY_FRESHNESS_MIN_DAYS,
  isNyseTradingDay,
  isTwHolidayProvisionalReviewOverdue,
  isTwseTradingDay,
  TW_HOLIDAYS_PROVISIONAL_UNTIL,
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

describe('isTwseTradingDay', () => {
  it('一般平日開市', () => {
    expect(isTwseTradingDay('2026-11-09')).toBe(true) // 週一
  })
  it('週末休市', () => {
    expect(isTwseTradingDay('2026-11-07')).toBe(false) // 週六
    expect(isTwseTradingDay('2026-11-08')).toBe(false) // 週日
  })
  it('休市表裡的平日休市', () => {
    expect(isTwseTradingDay('2026-09-25')).toBe(false) // 中秋節，週五
  })
  // 補班日是行政機關上班、股市不開：只看「是不是上班日」會把它判成開市。
  it('週六補班日不開市', () => {
    expect(isTwseTradingDay('2025-02-08')).toBe(false)
  })
})

describe('isNyseTradingDay', () => {
  it('一般平日開市', () => {
    expect(isNyseTradingDay('2026-11-09')).toBe(true) // 週一
  })
  it('週末休市', () => {
    expect(isNyseTradingDay('2026-11-07')).toBe(false) // 週六
    expect(isNyseTradingDay('2026-11-08')).toBe(false) // 週日
  })
  it('休市表裡的平日休市', () => {
    expect(isNyseTradingDay('2026-11-26')).toBe(false) // Thanksgiving，週四
  })
  // 台美休市表各自獨立：台股休市的平日美股照常開。
  it('台股休市日不影響美股', () => {
    expect(isNyseTradingDay('2026-09-25')).toBe(true) // 台股中秋節
  })
})

describe('休市表涵蓋起點 HOLIDAY_COVERAGE_START', () => {
  it('台美兩表的每一筆都落在涵蓋範圍內', () => {
    for (const d of [...TW_MARKET_HOLIDAYS, ...US_MARKET_HOLIDAYS]) {
      expect(d >= HOLIDAY_COVERAGE_START).toBe(true)
      expect(d <= HOLIDAY_COVERAGE_END).toBe(true)
    }
  })
})

// 2027 逐筆對照 NYSE Holidays & Trading Hours（https://www.nyse.com/markets/hours-calendars，查證日 2026-11-11）
describe('美股 2027 休市表', () => {
  it('與 NYSE 公告的 2027 全日休市逐筆相符', () => {
    expect(US_MARKET_HOLIDAYS.filter(d => d.startsWith('2027-'))).toEqual([
      '2027-01-01',
      '2027-01-18',
      '2027-02-15',
      '2027-03-26',
      '2027-05-31',
      '2027-06-18',
      '2027-07-05',
      '2027-09-06',
      '2027-11-25',
      '2027-12-24',
    ])
  })
  it('juneteenth 補假（06-18 週五）跳過', () => {
    expect(previousTradingDay('2027-06-21', 'us')).toBe('2027-06-17')
  })
  it('聖誕節補假（12-24 週五）跳過', () => {
    expect(previousTradingDay('2027-12-27', 'us')).toBe('2027-12-23')
  })
  it('跨年：元旦 2027-01-01 週五休市', () => {
    expect(previousTradingDay('2027-01-04', 'us')).toBe('2026-12-31')
  })
  it('感恩節隔天早收盤算開市', () => {
    expect(previousTradingDay('2027-11-29', 'us')).toBe('2027-11-26')
  })
  it('美股獨立紀念日補假但台股有開 → 照出', () => {
    expect(classifyPublicationDay('2027-07-06')).toEqual({ kind: 'weekday-brief' })
  })
})

// 2027 台股暫定表：TWSE 尚未公告 116 年開休市日期，逐筆對照人事行政總處「中華民國一百一十六年
// 政府行政機關辦公日曆表」（https://www.dgpa.gov.tw/information?uid=83&pid=13114，查證日 2026-11-11）
// 的平日放假日。TWSE 公告後要逐筆核對，尤其春節前「僅辦理結算交割」的日子。
describe('台股 2027 休市表（暫定）', () => {
  it('與 116 年辦公日曆表的平日放假日逐筆相符', () => {
    expect(TW_MARKET_HOLIDAYS.filter(d => d.startsWith('2027-'))).toEqual([
      '2027-01-01',
      '2027-02-04',
      '2027-02-05',
      '2027-02-08',
      '2027-02-09',
      '2027-02-10',
      '2027-03-01',
      '2027-04-05',
      '2027-04-06',
      '2027-04-30',
      '2027-06-09',
      '2027-09-15',
      '2027-09-28',
      '2027-10-11',
      '2027-10-25',
      '2027-12-24',
      '2027-12-31',
    ])
  })
  it('涵蓋終點推到 2027-12-31', () => {
    expect(HOLIDAY_COVERAGE_END).toBe('2027-12-31')
  })
  it('春節：除夕前一日起休市、開春首日開市', () => {
    expect(isTwseTradingDay('2027-02-04')).toBe(false)
    expect(isTwseTradingDay('2027-02-10')).toBe(false)
    expect(isTwseTradingDay('2027-02-11')).toBe(true)
    expect(previousTradingDay('2027-02-11', 'tw')).toBe('2027-02-03')
  })
  it('春節補假週一：台股休、前夜週日無美股 → skip', () => {
    expect(classifyPublicationDay('2027-02-08')).toEqual({ kind: 'skip', reason: 'holiday-no-material' })
  })
  it('春節補假週二：台股休、前夜美股有開 → 照出', () => {
    expect(classifyPublicationDay('2027-02-09')).toEqual({ kind: 'weekday-brief' })
  })
  it('端午節（06-09 週三）休市', () => {
    expect(isTwseTradingDay('2027-06-09')).toBe(false)
  })
  it('年末：12-24 行憲紀念日補假、12-31 元旦補假皆休市，12-30 開市', () => {
    expect(isTwseTradingDay('2027-12-24')).toBe(false)
    expect(isTwseTradingDay('2027-12-30')).toBe(true)
    expect(isTwseTradingDay('2027-12-31')).toBe(false)
  })
  it('年末 12-24 台股休、前夜 12-23 美股有開 → 照出', () => {
    expect(classifyPublicationDay('2027-12-24')).toEqual({ kind: 'weekday-brief' })
  })
})

// 暫定表核對期限：TWSE 公告 116 年開休市日期後，照公告核對 2027 台股表（春節前僅交割日最可能要補），
// 核對完把 TW_HOLIDAYS_PROVISIONAL_UNTIL 設為 null。期限到了 TWSE 仍未公告時，延後期限並寫明原因。
describe('台股暫定表核對期限', () => {
  // 邊界用固定日期，常數改成 null 之後仍測得到比較邏輯。
  it('期限前一刻 → 未逾期', () => {
    expect(isTwHolidayProvisionalReviewOverdue(new Date('2027-01-14T23:59:59Z'), '2027-01-15')).toBe(false)
  })
  it('期限當天 UTC 00:00（台北 08:00）起 → 逾期', () => {
    expect(isTwHolidayProvisionalReviewOverdue(new Date('2027-01-15T00:00:00Z'), '2027-01-15')).toBe(true)
  })
  it('null（已核對）→ 永不逾期', () => {
    expect(isTwHolidayProvisionalReviewOverdue(new Date('2099-01-01T00:00:00Z'), null)).toBe(false)
  })
  // 刻意用真實 new Date()：期限一到就紅、逼人照 TWSE 公告核對。這是預期設計、非 flaky——
  // 請勿因為它擋住 PR 就刪除；TWSE 仍未公告時延後期限並寫明原因。
  it('暫定表須在期限前照 TWSE 公告核對', () => {
    expect(
      isTwHolidayProvisionalReviewOverdue(new Date()),
      `2027 台股休市表仍是暫定版（依人事總處辦公日曆表），已過核對期限 ${TW_HOLIDAYS_PROVISIONAL_UNTIL}；`
      + `請照 TWSE 116 年市場開休市日期核對 packages/shared/src/market-holidays.ts，核對完把 TW_HOLIDAYS_PROVISIONAL_UNTIL 設為 null；`
      + `TWSE 仍未公告時延後期限並在註解寫明原因，不要刪除本測試`,
    ).toBe(false)
  })
})
