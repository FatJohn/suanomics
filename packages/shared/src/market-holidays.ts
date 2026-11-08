// publication SLO：應產日分類的單一真相。worker pipeline gate 與 api
// publication-status endpoint 共用；假日表也放本檔。
// 只看日期字串的星期幾（UTC 基準、date 即真相、不需時區換算——沿用原 report-day.ts 慣例）。

export type PublicationDayKind = 'weekday-brief' | 'weekly-recap' | 'skip'
export type SkipReason = 'saturday' | 'holiday-no-material'

export interface PublicationDay {
  kind: PublicationDayKind
  reason?: SkipReason
}

// 假日表：TWSE 休市日與 NYSE 假日（皆排除週末、半日交易算開市不列入）。年度手動更新、
// 下方 time-bomb 測試在涵蓋終點前 30 天自動紅、逼更新（比照 econ-calendar 前例）。
// 來源（查證日 2026-07-20，見下列出處）：
//   TWSE OpenAPI holidaySchedule（僅公告至 2026、ROC 115）
//   NYSE hours-calendars（full-day holidays）
// 涵蓋窗口：2026-07-21 起至 HOLIDAY_COVERAGE_END；台美兩表對稱截於此窗、2027 待年度更新一併補。
export const TW_MARKET_HOLIDAYS: readonly string[] = [
  '2026-09-25', // 中秋節
  '2026-09-28', // 孔子誕辰紀念日／教師節
  '2026-10-09', // 國慶日補假（10-10 適逢週六）
  '2026-10-26', // 臺灣光復節補假（10-25 適逢週日）
  '2026-12-25', // 行憲紀念日
]

export const US_MARKET_HOLIDAYS: readonly string[] = [
  '2026-09-07', // Labor Day
  '2026-11-26', // Thanksgiving Day
  '2026-12-25', // Christmas Day
]

// TWSE 尚未公告 2027（ROC 116）行事曆、故涵蓋終點退到 2026-12-31；NYSE 2027 雖已公告、
// 為與台股表對稱一併留待年度更新。time-bomb 會在 2026-12 初逼補（屬預期）。
export const HOLIDAY_COVERAGE_END = '2026-12-31'

export const HOLIDAY_FRESHNESS_MIN_DAYS = 30

const MS_PER_DAY = 86_400_000

export function daysUntilHolidayCoverageExhausted(now: Date): number {
  const end = new Date(`${HOLIDAY_COVERAGE_END}T00:00:00Z`).getTime()
  return Math.floor((end - now.getTime()) / MS_PER_DAY)
}

const TW_HOLIDAY_SET = new Set(TW_MARKET_HOLIDAYS)
const US_HOLIDAY_SET = new Set(US_MARKET_HOLIDAYS)

// shared 不可依賴 @suanomics/db、故不重用 storylines-repo 的 isoDateMinusDays（接受 8 行重複）。
function isoDateMinusDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

export function classifyPublicationDay(date: string): PublicationDay {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay() // 0=日、6=六
  if (dow === 6)
    return { kind: 'skip', reason: 'saturday' }
  if (dow === 0)
    return { kind: 'weekly-recap' }

  // 假日規則（台美都休才 skip）：台股 D 休市、且前夜（日曆日 D-1）無美股交易 → 無素材、skip。
  // 單邊開市照出：台股颱風假／國定假仍有前夜美股、美國假日仍有台股當日。
  const twOpen = !TW_HOLIDAY_SET.has(date)
  const prev = isoDateMinusDays(date, 1)
  const prevDow = new Date(`${prev}T00:00:00Z`).getUTCDay()
  const usOvernight = prevDow >= 1 && prevDow <= 5 && !US_HOLIDAY_SET.has(prev)
  if (!twOpen && !usOvernight)
    return { kind: 'skip', reason: 'holiday-no-material' }
  return { kind: 'weekday-brief' }
}
