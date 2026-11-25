import type { CalendarEvent } from '@suanomics/shared'
import { HOLIDAY_COVERAGE_END, HOLIDAY_COVERAGE_START, isNyseTradingDay, isTwseTradingDay } from '@suanomics/shared'

// 衍生品到期日：照日期規則加休市表在執行時算出，不寫進種子檔——休市表已是單一真相，
// 再存一份算好的日期會在休市表更新（例如 2027 台股暫定表核對後）時分岔。
//
// 規則來源（2026-11-11 查）：
// - 台指期：期交所臺股期貨契約規格「最後交易日為各該契約交割月份第三個星期三……若為假日或因
//   不可抗力因素未能進行交易時，以其最近之次一營業日為最後交易日」「最後結算日同最後交易日」。
//   春節前「無交易僅辦理結算交割」的日子也不是營業日（2023-01-18 起停止交易，官方結算日 01-30）。
// - 美股四巫日：3、6、9、12 月第三個週五，遇休市提前到前一個營業日（Cboe 2026 到期日曆：06-19
//   Juneteenth 休市，6 月標準到期標在 06-18）。
//
// 2027 台股休市表是暫定的（market-holidays.ts 的 TW_HOLIDAYS_PROVISIONAL_UNTIL），算出的
// 2027 台指期結算日跟著它走；TWSE 公告後核對休市表，這裡不用改。

export interface MarketRules {
  isTradingDay: (date: string) => boolean
  /** 休市表涵蓋範圍（含兩端）。範圍外判不出是否休市，不產出日期。 */
  coverageStart: string
  coverageEnd: string
}

// isTwseTradingDay 只看週末與 TW_MARKET_HOLIDAYS：春節前「僅辦理結算交割」的日子要列進休市表，
// 台指期結算日才會跟著順延。2027 暫定表還沒列這些日子，但 2027-02 第三個週三 02-17 在連假之後，不受影響。
const TW_RULES: MarketRules = {
  isTradingDay: isTwseTradingDay,
  coverageStart: HOLIDAY_COVERAGE_START,
  coverageEnd: HOLIDAY_COVERAGE_END,
}

const US_RULES: MarketRules = {
  isTradingDay: isNyseTradingDay,
  coverageStart: HOLIDAY_COVERAGE_START,
  coverageEnd: HOLIDAY_COVERAGE_END,
}

const QUARTER_MONTHS = new Set([3, 6, 9, 12])

// 規則日與順延方向的單一定義：公開函式與 deriveExpiryEvents 都從這裡算，告警報的規則日才會跟實際用的一致。
interface ExpiryRule {
  weekday: number
  step: 1 | -1
}
const TW_SETTLEMENT: ExpiryRule = { weekday: 3, step: 1 }
const US_QUAD_WITCHING: ExpiryRule = { weekday: 5, step: -1 }

// 涵蓋範圍外不知道會順延幾天，用這個上限判斷規則日在視窗外的那筆會不會落進視窗。
// 已知最長的是 2023-01 台指期：規則日 01-18、結算日 01-30，順延 12 天。
const MAX_ROLL_DAYS = 14

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

function resolveExpiry(rule: ExpiryRule, year: number, month: number, rules: MarketRules): string | null {
  return rollToTradingDay(thirdWeekdayOfMonth(year, month, rule.weekday), rule.step, rules)
}

/** 台指期月契約最後結算日；超出休市表涵蓋範圍回 null。 */
export function twIndexFuturesSettlement(year: number, month: number, rules: MarketRules = TW_RULES): string | null {
  return resolveExpiry(TW_SETTLEMENT, year, month, rules)
}

/** 美股四巫日（季月）；超出休市表涵蓋範圍回 null。 */
export function usQuadWitching(year: number, month: number, rules: MarketRules = US_RULES): string | null {
  if (!QUARTER_MONTHS.has(month))
    throw new Error(`四巫日只在季月：${year}-${pad(month)}`)
  return resolveExpiry(US_QUAD_WITCHING, year, month, rules)
}

export interface UncoveredExpiry {
  title: string
  /** 未經休市調整的規則日期，只給告警訊息說明是哪一筆，不可當事件日期用。 */
  rawDate: string
}

interface ExpiryKind {
  rule: ExpiryRule
  rules: MarketRules
  applies: (month: number) => boolean
  title: (ym: string) => string
  region: CalendarEvent['region']
}

const EXPIRY_KINDS: ExpiryKind[] = [
  {
    rule: TW_SETTLEMENT,
    rules: TW_RULES,
    applies: () => true,
    title: ym => `台指期 ${ym} 月契約最後結算日`,
    region: 'TW',
  },
  {
    rule: US_QUAD_WITCHING,
    rules: US_RULES,
    applies: m => QUARTER_MONTHS.has(m),
    title: ym => `美股四巫日（${ym} 季度期貨與選擇權到期）`,
    region: 'US',
  },
]

// 調整後的日期可能落在 [start, end] 的話回 true：往後順延的規則日最早要看到 start 前 MAX_ROLL_DAYS 天，
// 往前提前的最晚要看到 end 後 MAX_ROLL_DAYS 天。寧可多告警一筆，不漏掉落進視窗的那筆。
function mayLandInWindow(raw: string, step: 1 | -1, start: string, end: string): boolean {
  return step === 1
    ? raw >= shiftDays(start, -MAX_ROLL_DAYS) && raw <= end
    : raw >= start && raw <= shiftDays(end, MAX_ROLL_DAYS)
}

/**
 * [start, end]（含兩端，YYYY-MM-DD）內的衍生品到期事件。
 * 休市表涵蓋不到的月份不產出事件，而是把調整後可能落在視窗內的那幾筆列進 uncovered，
 * 讓呼叫端出聲；不拿未經調整的日期充數。
 */
export function deriveExpiryEvents(start: string, end: string): { events: CalendarEvent[], uncovered: UncoveredExpiry[] } {
  const events: CalendarEvent[] = []
  const uncovered: UncoveredExpiry[] = []
  // 前後各多掃一個月：上個月的台指期結算日順延、下個月的四巫日提前都可能落進視窗。
  let year = Number(start.slice(0, 4))
  let month = Number(start.slice(5, 7)) - 1
  if (month === 0) {
    year -= 1
    month = 12
  }
  while (`${year}-${pad(month)}` <= shiftDays(end, 31).slice(0, 7)) {
    const ym = `${year}-${pad(month)}`
    for (const kind of EXPIRY_KINDS.filter(k => k.applies(month))) {
      const raw = thirdWeekdayOfMonth(year, month, kind.rule.weekday)
      const date = rollToTradingDay(raw, kind.rule.step, kind.rules)
      if (date === null) {
        if (mayLandInWindow(raw, kind.rule.step, start, end))
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
