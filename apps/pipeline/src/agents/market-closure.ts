import { FORBIDDEN_PHRASES, HOLIDAY_COVERAGE_END, isTwseTradingDay, previousTradingDay } from '@suanomics/shared'
import { MARKET_CLOSURE_USER_TEXT } from '../prompts/market-closure.user-content.js'

export interface MarketClosure {
  previousTradingDay: string
  // 報告日與上一個交易日相差的曆日數，> 1 才算休市後第一個交易日。
  calendarDays: number
  closedDays: string[]
}

const MS_PER_DAY = 86_400_000
const WEEKDAY_LABEL = ['日', '一', '二', '三', '四', '五', '六']

function shiftDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * MS_PER_DAY).toISOString().slice(0, 10)
}

// 只看 TWSE：美股休市不影響台股是否開盤，也就不構成「休市期間」。
// 條件是距上一個交易日超過 1 個曆日，不寫死週一，連假後同樣適用。
// 超出休市表涵蓋終點時交易日曆不可信，寧可不判定（同 market-freshness.ts 的取捨）；
// 報告日本身休市（force 補跑）也不是「休市後第一個交易日」。
export function marketClosureBefore(briefDate: string): MarketClosure | null {
  if (briefDate > HOLIDAY_COVERAGE_END || !isTwseTradingDay(briefDate))
    return null
  const previous = previousTradingDay(briefDate, 'tw')
  const calendarDays = Math.round((Date.parse(`${briefDate}T00:00:00Z`) - Date.parse(`${previous}T00:00:00Z`)) / MS_PER_DAY)
  if (calendarDays <= 1)
    return null
  const closedDays = Array.from({ length: calendarDays - 1 }, (_, i) => shiftDays(previous, i + 1))
  return { previousTradingDay: previous, calendarDays, closedDays }
}

function shortDate(date: string): string {
  const [, mm = '', dd = ''] = date.split('-')
  return `${Number(mm)}/${Number(dd)}`
}

function labelled(date: string): string {
  return `${shortDate(date)}（${WEEKDAY_LABEL[new Date(`${date}T00:00:00Z`).getUTCDay()]}）`
}

export function buildMarketClosureBlock(briefDate: string): string | null {
  const closure = marketClosureBefore(briefDate)
  if (!closure)
    return null
  const first = closure.closedDays[0] ?? closure.previousTradingDay
  const last = closure.closedDays.at(-1) ?? first
  const range = first === last ? labelled(first) : `${labelled(first)}至 ${labelled(last)}`
  return [
    MARKET_CLOSURE_USER_TEXT.heading,
    MARKET_CLOSURE_USER_TEXT.summaryLine(labelled(closure.previousTradingDay), range, closure.calendarDays),
    MARKET_CLOSURE_USER_TEXT.coverageLine,
    MARKET_CLOSURE_USER_TEXT.datingLine(labelled(closure.previousTradingDay)),
    MARKET_CLOSURE_USER_TEXT.complianceLine(FORBIDDEN_PHRASES.join('、')),
  ].join('\n')
}
