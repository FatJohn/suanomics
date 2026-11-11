import type { CalendarEvent } from '@suanomics/shared'
import { HOLIDAY_COVERAGE_END, isTwseTradingDay, US_MARKET_HOLIDAYS } from '@suanomics/shared'

// 衍生品到期日：照日期規則加休市表在執行時算出，不寫進種子檔——休市表已是單一真相，
// 再存一份算好的日期會在休市表更新（例如 2027 台股暫定表核對後）時分岔。
//
// 規則來源（2026-11-11 查）：
// - 台指期：期交所臺股期貨契約規格「最後交易日為各該契約交割月份第三個星期三……若為假日或因
//   不可抗力因素未能進行交易時，以其最近之次一營業日為最後交易日」「最後結算日同最後交易日」。
//   春節前「無交易僅辦理結算交割」的日子也不是營業日（2023-01-18 起停止交易，官方結算日 01-30）。
// - 美股四巫日：3、6、9、12 月第三個週五；OCC 標準到期日遇休市提前到前一個營業日。
//
// 2027 台股休市表是暫定的（market-holidays.ts 的 TW_HOLIDAYS_PROVISIONAL_UNTIL），算出的
// 2027 台指期結算日跟著它走；TWSE 公告後核對休市表，這裡不用改。

export interface MarketRules {
  isTradingDay: (date: string) => boolean
  /** 休市表涵蓋範圍（含兩端）。範圍外判不出是否休市，不產出日期。 */
  coverageStart: string
  coverageEnd: string
}

// market-holidays.ts 的檔頭註明「涵蓋窗口：2026-07-21 起」，但沒有 export 成常數；
// 那個檔歸休市表維護者，這裡照抄一份，休市表往前補時要一起改。
const HOLIDAY_COVERAGE_START = '2026-07-21'

const US_HOLIDAY_SET = new Set(US_MARKET_HOLIDAYS)

const TW_RULES: MarketRules = {
  isTradingDay: isTwseTradingDay,
  coverageStart: HOLIDAY_COVERAGE_START,
  coverageEnd: HOLIDAY_COVERAGE_END,
}

const US_RULES: MarketRules = {
  isTradingDay: (date) => {
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay()
    return dow !== 0 && dow !== 6 && !US_HOLIDAY_SET.has(date)
  },
  coverageStart: HOLIDAY_COVERAGE_START,
  coverageEnd: HOLIDAY_COVERAGE_END,
}

const QUARTER_MONTHS = new Set([3, 6, 9, 12])

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function shiftDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** weekday：0=日 … 6=六。 */
export function thirdWeekdayOfMonth(year: number, month: number, weekday: number): string {
  const firstDow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay()
  const day = 1 + ((weekday - firstDow + 7) % 7) + 14
  return `${year}-${pad(month)}-${pad(day)}`
}

// 從 raw 往 step 方向找第一個交易日；走過的每一天都要在涵蓋範圍內，否則回 null。
function rollToTradingDay(raw: string, step: 1 | -1, rules: MarketRules): string | null {
  let date = raw
  while (date >= rules.coverageStart && date <= rules.coverageEnd) {
    if (rules.isTradingDay(date))
      return date
    date = shiftDays(date, step)
  }
  return null
}

/** 台指期月契約最後結算日；超出休市表涵蓋範圍回 null。 */
export function twIndexFuturesSettlement(year: number, month: number, rules: MarketRules = TW_RULES): string | null {
  return rollToTradingDay(thirdWeekdayOfMonth(year, month, 3), 1, rules)
}

/** 美股四巫日（季月）；超出休市表涵蓋範圍回 null。 */
export function usQuadWitching(year: number, month: number, rules: MarketRules = US_RULES): string | null {
  if (!QUARTER_MONTHS.has(month))
    throw new Error(`四巫日只在季月：${year}-${pad(month)}`)
  return rollToTradingDay(thirdWeekdayOfMonth(year, month, 5), -1, rules)
}

export interface UncoveredExpiry {
  title: string
  /** 未經休市調整的規則日期，只給告警訊息說明是哪一筆，不可當事件日期用。 */
  rawDate: string
}

interface ExpiryKind {
  applies: (month: number) => boolean
  raw: (year: number, month: number) => string
  resolve: (year: number, month: number) => string | null
  title: (ym: string) => string
  region: CalendarEvent['region']
}

const EXPIRY_KINDS: ExpiryKind[] = [
  {
    applies: () => true,
    raw: (y, m) => thirdWeekdayOfMonth(y, m, 3),
    resolve: (y, m) => twIndexFuturesSettlement(y, m),
    title: ym => `台指期 ${ym} 月契約最後結算日`,
    region: 'TW',
  },
  {
    applies: m => QUARTER_MONTHS.has(m),
    raw: (y, m) => thirdWeekdayOfMonth(y, m, 5),
    resolve: (y, m) => usQuadWitching(y, m),
    title: ym => `美股四巫日（${ym} 季度期貨與選擇權到期）`,
    region: 'US',
  },
]

/**
 * [start, end]（含兩端，YYYY-MM-DD）內的衍生品到期事件。
 * 休市表涵蓋不到的月份不產出事件，而是把規則日期落在視窗內的那幾筆列進 uncovered，
 * 讓呼叫端出聲；不拿未經調整的日期充數。
 */
export function deriveExpiryEvents(start: string, end: string): { events: CalendarEvent[], uncovered: UncoveredExpiry[] } {
  const events: CalendarEvent[] = []
  const uncovered: UncoveredExpiry[] = []
  // 從 start 前一個月掃起：上個月的台指期結算日順延後可能落進視窗。
  let year = Number(start.slice(0, 4))
  let month = Number(start.slice(5, 7)) - 1
  if (month === 0) {
    year -= 1
    month = 12
  }
  while (`${year}-${pad(month)}` <= end.slice(0, 7)) {
    const ym = `${year}-${pad(month)}`
    for (const kind of EXPIRY_KINDS.filter(k => k.applies(month))) {
      const date = kind.resolve(year, month)
      const raw = kind.raw(year, month)
      if (date === null) {
        if (raw >= start && raw <= end)
          uncovered.push({ title: kind.title(ym), rawDate: raw })
      }
      else if (date >= start && date <= end) {
        events.push({ date, title: kind.title(ym), region: kind.region, importance: 'medium', category: 'derivatives-expiry' })
      }
    }
    month += 1
    if (month === 13) {
      year += 1
      month = 1
    }
  }
  events.sort((a, b) => a.date.localeCompare(b.date))
  return { events, uncovered }
}
