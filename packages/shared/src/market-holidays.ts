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
// 來源：
//   2026 台股：TWSE OpenAPI holidaySchedule（查證日 2026-07-20）
//   2027 台股（暫定）：TWSE 尚未公告 116 年開休市日期，先用人事行政總處 116 年政府行政機關
//     辦公日曆表的平日放假日（查證日 2026-11-11）。TWSE 公告後要逐筆核對，春節前「市場無交易，
//     僅辦理結算交割」的日子不在辦公日曆表上，可能要補。
//   美股：NYSE hours-calendars（full-day holidays；2026 查證日 2026-07-20、2027 查證日 2026-11-11）
// 涵蓋窗口：2026-07-21 起至 HOLIDAY_COVERAGE_END；台美兩表對稱截於此窗。
export const TW_MARKET_HOLIDAYS: readonly string[] = [
  '2026-09-25', // 中秋節
  '2026-09-28', // 孔子誕辰紀念日／教師節
  '2026-10-09', // 國慶日補假（10-10 適逢週六）
  '2026-10-26', // 臺灣光復節補假（10-25 適逢週日）
  '2026-12-25', // 行憲紀念日
  // 2027（暫定，見上方來源說明）
  '2027-01-01', // 中華民國開國紀念日
  '2027-02-04', // 農曆除夕前一日
  '2027-02-05', // 農曆除夕
  '2027-02-08', // 春節（初三）
  '2027-02-09', // 春節補假（初一 02-06 適逢週六）
  '2027-02-10', // 春節補假（初二 02-07 適逢週日）
  '2027-03-01', // 和平紀念日補假（02-28 適逢週日）
  '2027-04-05', // 民族掃墓節
  '2027-04-06', // 兒童節補假（04-04 適逢週日）
  '2027-04-30', // 勞動節補假（05-01 適逢週六）
  '2027-06-09', // 端午節
  '2027-09-15', // 中秋節
  '2027-09-28', // 孔子誕辰紀念日／教師節
  '2027-10-11', // 國慶日補假（10-10 適逢週日）
  '2027-10-25', // 臺灣光復暨金門古寧頭大捷紀念日
  '2027-12-24', // 行憲紀念日補假（12-25 適逢週六）
  '2027-12-31', // 中華民國開國紀念日補假（2028-01-01 適逢週六）
]

export const US_MARKET_HOLIDAYS: readonly string[] = [
  '2026-09-07', // Labor Day
  '2026-11-26', // Thanksgiving Day
  '2026-12-25', // Christmas Day
  // 2027：NYSE hours-calendars 已公告（查證日 2026-11-11）
  '2027-01-01', // New Year's Day
  '2027-01-18', // Martin Luther King, Jr. Day
  '2027-02-15', // Washington's Birthday
  '2027-03-26', // Good Friday
  '2027-05-31', // Memorial Day
  '2027-06-18', // Juneteenth National Independence Day（06-19 適逢週六，週五補假）
  '2027-07-05', // Independence Day（07-04 適逢週日，週一補假）
  '2027-09-06', // Labor Day
  '2027-11-25', // Thanksgiving Day（11-26 早收盤算開市、不列入）
  '2027-12-24', // Christmas Day（12-25 適逢週六，週五補假）
]

// 2027 台股表是暫定版（見上方來源說明）；time-bomb 會在 2027-12 初逼下一次年度更新（屬預期）。
export const HOLIDAY_COVERAGE_END = '2027-12-31'

export const HOLIDAY_FRESHNESS_MIN_DAYS = 30

const MS_PER_DAY = 86_400_000

export function daysUntilHolidayCoverageExhausted(now: Date): number {
  const end = new Date(`${HOLIDAY_COVERAGE_END}T00:00:00Z`).getTime()
  return Math.floor((end - now.getTime()) / MS_PER_DAY)
}

const TW_HOLIDAY_SET = new Set(TW_MARKET_HOLIDAYS)
const US_HOLIDAY_SET = new Set(US_MARKET_HOLIDAYS)

// shared 不可依賴 apps/pipeline、故不重用 storylines-repo 的 isoDateMinusDays（接受 8 行重複）。
function isoDateMinusDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

// 只看週末與休市表：補班日是行政機關上班，TWSE 仍不開市，所以週六一律休市。
// 超出 HOLIDAY_COVERAGE_END 的日期由上方 time-bomb 測試逼更新。
export function isTwseTradingDay(date: string): boolean {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay()
  return dow !== 0 && dow !== 6 && !TW_HOLIDAY_SET.has(date)
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
