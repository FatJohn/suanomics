// 序列新鮮度的單一真相。
//
// 核心觀念：**「幾天沒動」不等於「該不該有新資料」**。市場數據按各自的發布節奏更新
// （每交易日／每週一／每月中），用絕對曆日去量它必然兩頭錯——準時發布的月頻序列被誤殺，
// 而少一個交易日的日頻序列（us-sox 靜默 T-1）又抓不到。
// 這裡改成先算「此刻應該有哪一天的資料」（expectedAsOf），再看實際落後幾個發布週期。
import { z } from 'zod'
import { HOLIDAY_COVERAGE_END, TW_MARKET_HOLIDAYS, US_MARKET_HOLIDAYS } from './market-holidays.js'

/**
 * 每條序列的發布節奏。值必須來自對來源發布日曆的實測、不可推測——
 * 同屬 FRED「每營業日發布」的 H.15，DGS10 內容落後 1 營業日、T10YIE 落後 0，
 * 所以連 (source, frequency) 都推不出來。
 */
export type FreshnessRule
  // 交易日曆：期望＝報告日往前數 lagTradingDays 個該市場交易日
  = | { cadence: 'trading-daily', market: 'tw' | 'us', lagTradingDays: number }
  // 每週固定 dow 發布（1=一 … 5=五）、內容蓋到發布日往前 coverageLagDays 個曆日
    | { cadence: 'weekly', releaseDow: 1 | 2 | 3 | 4 | 5, coverageLagDays: number }
  // 每月發布：參考月**結束後** releaseDaysAfterMonthEnd 個曆日可得。
  // 從月底起算而非月初：月份長度 28–31 天不一，從月初算會讓長月提早翻月、每個月固定
  // 產生幾天的假「落後 1 個月」標注（實作時被回歸測試抓到、不要改回去）。
  // 值取實測發布日的**保守上界**：估晚只延後幾天才察覺真的缺月，估早則天天誤標。
    | { cadence: 'monthly', releaseDaysAfterMonthEnd: number }

export const SeriesFreshnessSchema = z.object({
  seriesId: z.string(),
  /** 此刻「應該」有的最新資料日；null = 算不出來（假日表涵蓋窗外） */
  expectedAsOf: z.string().nullable(),
  /** DB 實際最新資料日；null = 這條序列一個點都沒有 */
  actualAsOf: z.string().nullable(),
  /** 落後幾個發布週期（交易日／週／月，依 cadence）；null = 無法判定 */
  lagCycles: z.number().int().nullable(),
  state: z.enum(['fresh', 'lagging', 'stale', 'missing', 'unknown']),
})
export type SeriesFreshness = z.infer<typeof SeriesFreshnessSchema>

/**
 * 落後幾個週期就不再給數字（改顯示「資料未更新」）。
 * 這是**相對期望**的上限、不是絕對曆日——準時發布的序列 lagCycles 恆為 0、永遠不會被誤殺。
 */
export const STALE_HIDE_CYCLES = 3

const TW_HOLIDAYS = new Set(TW_MARKET_HOLIDAYS)
const US_HOLIDAYS = new Set(US_MARKET_HOLIDAYS)
const MS_PER_DAY = 86_400_000

function toUtc(date: string): Date {
  return new Date(`${date}T00:00:00Z`)
}

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function shiftDays(date: string, days: number): string {
  const d = toUtc(date)
  d.setUTCDate(d.getUTCDate() + days)
  return toIso(d)
}

function dowOf(date: string): number {
  return toUtc(date).getUTCDay() // 0=日、6=六
}

function nextMonthStart(monthStart: string): string {
  const y = Number(monthStart.slice(0, 4))
  const m = Number(monthStart.slice(5, 7))
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
}

function previousMonthStart(monthStart: string): string {
  const y = Number(monthStart.slice(0, 4))
  const m = Number(monthStart.slice(5, 7))
  return m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, '0')}-01`
}

function isTradingDay(date: string, market: 'tw' | 'us'): boolean {
  const dow = dowOf(date)
  if (dow === 0 || dow === 6)
    return false
  return !(market === 'tw' ? TW_HOLIDAYS : US_HOLIDAYS).has(date)
}

/** 給讀者面用：判斷某筆資料是不是「該市場最近一個交易日」的值。 */
export function previousTradingDay(date: string, market: 'tw' | 'us'): string {
  let cursor = shiftDays(date, -1)
  // 連假最長不會接近 30 天、給足上限避免無窮迴圈
  for (let i = 0; i < 30 && !isTradingDay(cursor, market); i++)
    cursor = shiftDays(cursor, -1)
  return cursor
}

/**
 * 假日表只涵蓋到 HOLIDAY_COVERAGE_END。超出後交易日曆不可信，寧可回 null 讓上游走
 * unknown 降級，也不要把「本來就休市」誤標成「資料落後一天」——錯誤的標注進 prompt
 * 比沒有標注更壞。market-holidays 的 time-bomb 測試會在涵蓋終點前 30 天逼更新。
 */
function withinHolidayCoverage(reportDate: string): boolean {
  return reportDate <= HOLIDAY_COVERAGE_END
}

export function expectedAsOf(rule: FreshnessRule, reportDate: string): string | null {
  if (rule.cadence === 'monthly') {
    // 月頻不看交易日曆、涵蓋窗外仍可判定。
    // 從報告日所在月往回找第一個「已過發布日」的參考月。
    let cursor = `${reportDate.slice(0, 7)}-01`
    for (let i = 0; i < 24; i++) {
      const monthEnd = shiftDays(nextMonthStart(cursor), -1)
      if (shiftDays(monthEnd, rule.releaseDaysAfterMonthEnd) <= reportDate)
        return cursor
      cursor = previousMonthStart(cursor)
    }
    return null
  }

  if (!withinHolidayCoverage(reportDate))
    return null

  if (rule.cadence === 'trading-daily') {
    let cursor = reportDate
    for (let i = 0; i < rule.lagTradingDays; i++)
      cursor = previousTradingDay(cursor, rule.market)
    return cursor
  }

  // weekly：發布日 ET 傍晚上架＝台北隔日凌晨才拿得到，故只認 releaseDow <= reportDate-1 的那次。
  let release = shiftDays(reportDate, -1)
  for (let i = 0; i < 7 && dowOf(release) !== rule.releaseDow; i++)
    release = shiftDays(release, -1)
  return shiftDays(release, -rule.coverageLagDays)
}

function tradingDaysBetween(from: string, to: string, market: 'tw' | 'us'): number {
  // 計「嚴格晚於 from 且不晚於 to」的交易日數
  let count = 0
  let cursor = to
  while (cursor > from) {
    if (isTradingDay(cursor, market))
      count++
    cursor = shiftDays(cursor, -1)
  }
  return count
}

function monthsBetween(from: string, to: string): number {
  const [fy, fm] = [Number(from.slice(0, 4)), Number(from.slice(5, 7))]
  const [ty, tm] = [Number(to.slice(0, 4)), Number(to.slice(5, 7))]
  return (ty - fy) * 12 + (tm - fm)
}

/** switch 漏掉某個 cadence 時由 compiler 擋——沒有這道，新 cadence 會靜默沿用最後一個分支的算法。 */
function assertNeverCadence(rule: never): never {
  throw new Error(`unhandled freshness cadence: ${JSON.stringify(rule)}`)
}

export function lagCycles(rule: FreshnessRule, expected: string, actual: string): number {
  // 實際比期望新＝來源提前發布、不是落後
  if (actual >= expected)
    return 0
  switch (rule.cadence) {
    case 'trading-daily':
      return tradingDaysBetween(actual, expected, rule.market)
    case 'monthly':
      return monthsBetween(actual, expected)
    case 'weekly':
      // 兩次發布的覆蓋終點固定相隔 7 天
      return Math.round((toUtc(expected).getTime() - toUtc(actual).getTime()) / MS_PER_DAY / 7)
    default:
      return assertNeverCadence(rule)
  }
}

export interface ClassifyFreshnessArgs {
  seriesId: string
  rule: FreshnessRule
  reportDate: string
  actualAsOf: string | null
}

export function classifyFreshness(args: ClassifyFreshnessArgs): SeriesFreshness {
  const expected = expectedAsOf(args.rule, args.reportDate)
  const base = { seriesId: args.seriesId, expectedAsOf: expected, actualAsOf: args.actualAsOf }

  if (args.actualAsOf == null)
    return { ...base, lagCycles: null, state: 'missing' }
  if (expected == null)
    return { ...base, lagCycles: null, state: 'unknown' }

  const lag = lagCycles(args.rule, expected, args.actualAsOf)
  const state = lag === 0 ? 'fresh' : lag >= STALE_HIDE_CYCLES ? 'stale' : 'lagging'
  return { ...base, lagCycles: lag, state }
}

/** 落後標注措辭。這段文字會進 LLM prompt、由測試逐字釘住、不要順手改。 */
export function formatLagLabel(rule: FreshnessRule, cycles: number): string {
  switch (rule.cadence) {
    case 'trading-daily':
      return `落後 ${cycles} 個交易日`
    case 'weekly':
      return `落後 ${cycles} 週`
    case 'monthly':
      return `落後 ${cycles} 個月`
    default:
      return assertNeverCadence(rule)
  }
}
