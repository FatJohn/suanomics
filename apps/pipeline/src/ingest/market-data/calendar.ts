import type { CalendarCoverage, CalendarEvent } from '@suanomics/shared'
import { CalendarEventSchema, isCompanyCalendarEvent } from '@suanomics/shared'
import { z } from 'zod'

// 種子檔的外層形狀。事件本身的 schema 在 @suanomics/shared——worker parse 它、brief 存它、
// 讀者面渲染它，三端同一個形狀。
export const EconCalendarSchema = z.object({
  events: z.array(CalendarEventSchema),
})

export type EconEvent = CalendarEvent

const isCompanyEvent = isCompanyCalendarEvent

/**
 * 公司事件類別 → 中文名的單一對照。補產除權息涵蓋狀態這次修正：`context.ts` 原本各自用字面量字串
 * 當 `loadCompanyEvents` 的 label 參數，跟這裡即將要印的註記行各寫一份、遲早分岔
 * （這個 repo 有「一句宣稱常有兩份、只改一份」的教訓）。兩邊改用同一份 map。
 */
export const COMPANY_CALENDAR_CATEGORY_LABELS: Record<'ex-dividend' | 'investor-conference', string> = {
  'ex-dividend': '除權息',
  'investor-conference': '法說會',
}

/**
 * 各類別的來源名稱，只給 out-of-range 註記行說明「射程是誰的射程」用。
 * 與 label 分開兩份 map 而不是寫死在註記字串裡：`resolveCalendarCoverage` 的
 * `supportsHistory` 是參數，任何一類都可能被判成 out-of-range，寫死「TWSE 除權息
 * 預告表」的話法說會那一類會印出別人的來源名——錯字串、而且靜默。
 */
export const COMPANY_CALENDAR_SOURCE_NAMES: Record<'ex-dividend' | 'investor-conference', string> = {
  'ex-dividend': 'TWSE 除權息預告表',
  'investor-conference': 'MOPS 法說會公告',
}

/**
 * 行事曆視窗天數的單一定義。selectCalendarWindow／buildCalendarBlock 的預設值與
 * context.ts 算 coverage 窗尾都用它——分成三份字面量的話，改預設值會讓 coverage
 * 的判準跟 buildCalendarBlock 實際採用的視窗靜默分岔。
 */
export const CALENDAR_HORIZON_DAYS = 7

/**
 * 把非 covered 的 coverage 狀態轉成一行中文註記，附在「## 本週公司事件」區塊尾端。
 * out-of-range／unavailable 的判定邏輯在 context.ts（`resolveCalendarCoverage`），
 * 這裡只負責把狀態講成人看得懂的話。
 */
// horizonDays 要吃呼叫端實際採用的那個值、不是常數預設值——非預設呼叫時，
// 註記行印的天數必須跟這次真的用的視窗一致，否則會對讀者說錯射程。
function buildCoverageNote(coverage: CalendarCoverage, horizonDays: number): string {
  const label = COMPANY_CALENDAR_CATEGORY_LABELS[coverage.category]
  if (coverage.state === 'out-of-range') {
    return `- ${label}：不適用。資料來源是 ${COMPANY_CALENDAR_SOURCE_NAMES[coverage.category]}，`
      + `只涵蓋 ${coverage.sourceEarliestDate ?? '（來源日期未知）'} 起的事件，`
      + `本報告日的 ${horizonDays} 天窗落在它之前。`
  }
  // unavailable：抓取失敗或來源回零筆，無法判斷涵蓋範圍。
  return `- ${label}：資料暫時無法取得，本次未納入。`
}

/**
 * 取 [now 當日, now+horizonDays] 視窗內的事件、依日期升冪。
 * 這是「這份報告涵蓋哪些即將發生的事」的單一定義：buildCalendarBlock 拿它排 prompt
 * markdown，pipeline 拿同一份存進 brief 給讀者面——兩邊看到的事件必然一致。
 * 日期用字串比較（避免跨時區位移）。
 */
export function selectCalendarWindow(
  events: EconEvent[],
  now: Date,
  horizonDays = CALENDAR_HORIZON_DAYS,
): EconEvent[] {
  const start = toDateString(now)
  const end = toDateString(new Date(now.getTime() + horizonDays * 24 * 60 * 60 * 1000))
  return events
    .filter(e => e.date >= start && e.date <= end)
    .sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * 把視窗內事件依 category 分兩區塊 markdown：
 * - 總經（macro / undefined）→「## 本週財經行事曆」、列尾帶（region、importance）。
 * - 公司（除權息 / 法說會）→「## 本週公司事件」、列尾不帶 region/importance（title 已自述）。
 * 各區塊內升冪排序；空區塊省略；兩區塊皆空回 null。
 *
 * `coverage`（選填，不給即現行行為零改動）：任一類 state !== 'covered'
 * 時，「## 本週公司事件」一定要出現（即使窗內零事件）並附一行註記——這是刻意讓
 * 「來源涵蓋不到」跟「這週真的沒事件」在報告上長得不一樣，不要因為 companyLines
 * 空了就把整段省略掉、悄悄退回舊行為。
 */
export function buildCalendarBlock(
  events: EconEvent[],
  now: Date,
  horizonDays = CALENDAR_HORIZON_DAYS,
  coverage?: CalendarCoverage[],
): string | null {
  const inWindow = selectCalendarWindow(events, now, horizonDays)

  const macroLines = inWindow
    .filter(e => !isCompanyEvent(e))
    .map(e => `- ${e.date}：${e.title}（${e.region}、${e.importance}）`)
  const companyLines = inWindow
    .filter(isCompanyEvent)
    .map(e => `- ${e.date}：${e.title}`)
  const coverageNotes = (coverage ?? [])
    .filter(c => c.state !== 'covered')
    .map(c => buildCoverageNote(c, horizonDays))

  const blocks: string[] = []
  if (macroLines.length > 0)
    blocks.push(['## 本週財經行事曆', ...macroLines].join('\n'))
  if (companyLines.length > 0 || coverageNotes.length > 0)
    blocks.push(['## 本週公司事件', ...companyLines, ...coverageNotes].join('\n'))

  return blocks.length > 0 ? blocks.join('\n\n') : null
}

export const CALENDAR_FRESHNESS_MIN_DAYS = 30

/**
 * 種子健康度：最遠事件日期距 now 的日曆天數（可為負＝最遠事件已過期）。
 * 空陣列回 -Infinity（絕對不健康）。與 buildCalendarBlock 一致用 UTC 日對齊。
 * 給 freshness 守門測試（calendar.test.ts）與 loadCalendarBlock 的 runtime warn 共用。
 */
export function daysUntilCalendarExhausted(events: EconEvent[], now: Date): number {
  if (events.length === 0)
    return Number.NEGATIVE_INFINITY
  const farthest = events.map(e => e.date).reduce((max, d) => (d > max ? d : max))
  const farthestMs = Date.parse(`${farthest}T00:00:00Z`)
  const nowMs = Date.parse(`${toDateString(now)}T00:00:00Z`)
  return Math.round((farthestMs - nowMs) / 86_400_000)
}

// UTC 日曆日字串、與 calendar JSON 的 YYYY-MM-DD 對齊。
// export 給 context.ts 算 coverage 的 windowEnd 用——窗尾一定要跟 selectCalendarWindow
// 用同一個日期加法，不要另外寫一份（同「一句宣稱兩份」的教訓）。
export function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10)
}
