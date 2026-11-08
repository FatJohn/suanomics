import { describe, expect, it } from 'vitest'
import {
  classifyFreshness,
  expectedAsOf,
  formatLagLabel,
  lagCycles,
  STALE_HIDE_CYCLES,
} from './market-freshness.js'

// 規則實例取自 2026-07-31 對 FRED release 日曆的實測
const US_DAILY_LAG1 = { cadence: 'trading-daily', market: 'us', lagTradingDays: 1 } as const
const US_DAILY_LAG2 = { cadence: 'trading-daily', market: 'us', lagTradingDays: 2 } as const
const TW_DAILY = { cadence: 'trading-daily', market: 'tw', lagTradingDays: 1 } as const
const WEEKLY_MON = { cadence: 'weekly', releaseDow: 1, coverageLagDays: 3 } as const // H.10 外匯
const WEEKLY_WED = { cadence: 'weekly', releaseDow: 3, coverageLagDays: 2 } as const // Spot Prices
const MONTHLY_CPI = { cadence: 'monthly', releaseDaysAfterMonthEnd: 15 } as const
const MONTHLY_M2 = { cadence: 'monthly', releaseDaysAfterMonthEnd: 29 } as const
const MONTHLY_PAYROLLS = { cadence: 'monthly', releaseDaysAfterMonthEnd: 7 } as const

describe('expectedAsOf：trading-daily', () => {
  it('lag 1 = 報告日前一個交易日', () => {
    expect(expectedAsOf(US_DAILY_LAG1, '2026-07-31')).toBe('2026-07-30') // 週五 → 週四
    expect(expectedAsOf(TW_DAILY, '2026-07-31')).toBe('2026-07-30')
  })
  it('lag 2 = 前兩個交易日（H.15 家族）', () => {
    expect(expectedAsOf(US_DAILY_LAG2, '2026-07-31')).toBe('2026-07-29')
  })
  it('跨週末：週一報告日往前推到週五', () => {
    expect(expectedAsOf(US_DAILY_LAG1, '2026-07-27')).toBe('2026-07-24') // 週一 → 前週五
    expect(expectedAsOf(US_DAILY_LAG2, '2026-07-27')).toBe('2026-07-23')
  })
  it('跨美股假日：感恩節不算交易日', () => {
    // 2026-11-26（四）感恩節休市 → 11-27（五）的前一個美股交易日是 11-25（三）
    expect(expectedAsOf(US_DAILY_LAG1, '2026-11-27')).toBe('2026-11-25')
  })
  it('跨台股假日：台股表與美股表各自獨立', () => {
    // 2026-09-28（一）教師節台股休 → 09-29（二）的前一個台股交易日是 09-24（四、09-25 中秋亦休）
    expect(expectedAsOf(TW_DAILY, '2026-09-29')).toBe('2026-09-24')
    // 同一天對美股而言 09-28 是正常交易日
    expect(expectedAsOf(US_DAILY_LAG1, '2026-09-29')).toBe('2026-09-28')
  })
  it('超出假日表涵蓋窗回 null（不可信、不硬算）', () => {
    expect(expectedAsOf(US_DAILY_LAG1, '2027-01-05')).toBeNull()
  })
})

describe('expectedAsOf：weekly', () => {
  it('週一發布、蓋到前一個週五（H.10）', () => {
    // 07-27（一）發布 → 台北 07-28 起可得；07-31（五）期望 07-24
    expect(expectedAsOf(WEEKLY_MON, '2026-07-31')).toBe('2026-07-24')
    expect(expectedAsOf(WEEKLY_MON, '2026-07-28')).toBe('2026-07-24')
  })
  it('發布當日尚未可得（台北隔日才拿得到）', () => {
    // 07-27（一）當天早上 05:10 跑，最新可得的仍是 07-20 那次發布 → 蓋到 07-17
    expect(expectedAsOf(WEEKLY_MON, '2026-07-27')).toBe('2026-07-17')
  })
  it('週三發布、蓋到前一個週一（Spot Prices）', () => {
    expect(expectedAsOf(WEEKLY_WED, '2026-07-31')).toBe('2026-07-27')
    expect(expectedAsOf(WEEKLY_WED, '2026-07-29')).toBe('2026-07-20')
  })
  it('超出涵蓋窗回 null', () => {
    expect(expectedAsOf(WEEKLY_MON, '2027-01-05')).toBeNull()
  })
})

describe('expectedAsOf：monthly（不需假日表、涵蓋窗外仍可算）', () => {
  it('月頻 CPI 月底後 15 天可得：07-31 期望 6 月', () => {
    expect(expectedAsOf(MONTHLY_CPI, '2026-07-31')).toBe('2026-06-01')
  })
  it('月頻 CPI 在發布日當天才翻月', () => {
    expect(expectedAsOf(MONTHLY_CPI, '2026-07-14')).toBe('2026-05-01') // 6 月數據實測 07-14 發、設定取保守的 07-15
    expect(expectedAsOf(MONTHLY_CPI, '2026-07-15')).toBe('2026-06-01')
  })
  it('月頻 M2 月底後 29 天可得：07-31 期望 6 月（舊 45 天門檻下永遠 stale 的那條）', () => {
    expect(expectedAsOf(MONTHLY_M2, '2026-07-31')).toBe('2026-06-01')
  })
  it('非農月底後 7 天可得（次月第一個週五的上界）', () => {
    expect(expectedAsOf(MONTHLY_PAYROLLS, '2026-07-31')).toBe('2026-06-01')
    // 8/1 時 7 月數據還沒發（月底 +7 = 08-07）、期望仍是 6 月
    expect(expectedAsOf(MONTHLY_PAYROLLS, '2026-08-01')).toBe('2026-06-01')
    expect(expectedAsOf(MONTHLY_PAYROLLS, '2026-08-07')).toBe('2026-07-01')
  })
  it('涵蓋窗外照算（月頻不看交易日曆）', () => {
    expect(expectedAsOf(MONTHLY_CPI, '2027-03-01')).toBe('2027-01-01')
  })
  it('跨年往回找參考月', () => {
    expect(expectedAsOf(MONTHLY_CPI, '2027-01-10')).toBe('2026-11-01')
  })
})

describe('lagCycles', () => {
  it('trading-daily 以交易日計數、跳過週末', () => {
    expect(lagCycles(US_DAILY_LAG1, '2026-07-30', '2026-07-30')).toBe(0)
    expect(lagCycles(US_DAILY_LAG1, '2026-07-30', '2026-07-29')).toBe(1)
    expect(lagCycles(US_DAILY_LAG1, '2026-07-27', '2026-07-23')).toBe(2) // 週一 vs 前週四
  })
  it('weekly 以發布週期計數', () => {
    expect(lagCycles(WEEKLY_MON, '2026-07-24', '2026-07-24')).toBe(0)
    expect(lagCycles(WEEKLY_MON, '2026-07-24', '2026-07-17')).toBe(1)
    expect(lagCycles(WEEKLY_MON, '2026-07-24', '2026-07-10')).toBe(2)
  })
  it('monthly 以月計數', () => {
    expect(lagCycles(MONTHLY_CPI, '2026-06-01', '2026-06-01')).toBe(0)
    expect(lagCycles(MONTHLY_CPI, '2026-06-01', '2026-05-01')).toBe(1)
    expect(lagCycles(MONTHLY_CPI, '2026-01-01', '2025-11-01')).toBe(2) // 跨年
  })
  it('實際比期望新時夾為 0（來源提前發布、不是落後）', () => {
    expect(lagCycles(US_DAILY_LAG1, '2026-07-29', '2026-07-30')).toBe(0)
    expect(lagCycles(MONTHLY_CPI, '2026-05-01', '2026-06-01')).toBe(0)
  })
})

describe('classifyFreshness：五種狀態', () => {
  const base = { seriesId: 'us-sox', rule: US_DAILY_LAG1, reportDate: '2026-07-31' }

  it('準時 → fresh', () => {
    expect(classifyFreshness({ ...base, actualAsOf: '2026-07-30' })).toEqual({
      seriesId: 'us-sox',
      expectedAsOf: '2026-07-30',
      actualAsOf: '2026-07-30',
      lagCycles: 0,
      state: 'fresh',
    })
  })
  it('落後 1 個交易日 → lagging（靜默沿用 T-1 的情境）', () => {
    const r = classifyFreshness({ ...base, actualAsOf: '2026-07-29' })
    expect(r.state).toBe('lagging')
    expect(r.lagCycles).toBe(1)
  })
  it('落後達硬上限 → stale', () => {
    // STALE_HIDE_CYCLES = 3：期望 07-30、實際 07-27（週一）＝落後 3 個交易日
    const r = classifyFreshness({ ...base, actualAsOf: '2026-07-27' })
    expect(r.lagCycles).toBe(STALE_HIDE_CYCLES)
    expect(r.state).toBe('stale')
  })
  it('無資料點 → missing', () => {
    const r = classifyFreshness({ ...base, actualAsOf: null })
    expect(r).toMatchObject({ state: 'missing', lagCycles: null, actualAsOf: null })
  })
  it('涵蓋窗外 → unknown（不標注落後、交給降級路徑判）', () => {
    const r = classifyFreshness({ ...base, reportDate: '2027-01-05', actualAsOf: '2026-12-30' })
    expect(r).toMatchObject({ state: 'unknown', expectedAsOf: null, lagCycles: null })
  })
})

describe('回歸：現行絕對曆日門檻誤殺的序列，改判後皆為 fresh', () => {
  // 這組日期是 2026-07-31 對 prod /api/market/snapshot 與 FRED API 的實測值。
  // 舊規則（monthly 45／daily 5 曆日）會把這些全判「資料未更新」、共 12/26 行。
  const cases: { id: string, rule: Parameters<typeof classifyFreshness>[0]['rule'], actual: string }[] = [
    { id: 'us-cpi-yoy', rule: MONTHLY_CPI, actual: '2026-06-01' },
    { id: 'us-m2-yoy', rule: MONTHLY_M2, actual: '2026-06-01' },
    { id: 'us-nonfarm-payrolls', rule: MONTHLY_PAYROLLS, actual: '2026-06-01' },
    { id: 'usd-twd', rule: WEEKLY_MON, actual: '2026-07-24' },
    { id: 'usd-index', rule: WEEKLY_MON, actual: '2026-07-24' },
    { id: 'wti-oil', rule: WEEKLY_WED, actual: '2026-07-27' },
    { id: 'us-10y-yield', rule: US_DAILY_LAG2, actual: '2026-07-29' },
    { id: 'taiex-close', rule: TW_DAILY, actual: '2026-07-30' },
  ]
  it.each(cases)('$id 準時發布時判 fresh', ({ id, rule, actual }) => {
    const r = classifyFreshness({ seriesId: id, rule, reportDate: '2026-07-31', actualAsOf: actual })
    expect(r.state).toBe('fresh')
    expect(r.lagCycles).toBe(0)
  })
})

describe('formatLagLabel：措辭進 prompt、逐字釘住', () => {
  it('三種 cadence 各自的單位', () => {
    expect(formatLagLabel(US_DAILY_LAG1, 1)).toBe('落後 1 個交易日')
    expect(formatLagLabel(TW_DAILY, 2)).toBe('落後 2 個交易日')
    expect(formatLagLabel(WEEKLY_MON, 1)).toBe('落後 1 週')
    expect(formatLagLabel(MONTHLY_CPI, 1)).toBe('落後 1 個月')
  })
})
