import type { CalendarCoverage, CalendarEvent } from '@suanomics/shared'

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'] as const

/**
 * 帶上最多放幾格。帶是水平捲的，所以上限不是版面撐不撐得住的問題——是塞滿三十筆
 * 之後這條帶就沒有重點了。12 格在 972 框寬下大約捲一屏半。
 */
export const CALENDAR_BAND_MAX_ITEMS = 12

/** 時間軸帶只需要三個欄位；`alert` 是從 importance/category 推的，不是資料源給的。 */
export interface CalendarBandEvent {
  /** ISO `YYYY-MM-DD` */
  date: string
  title: string
  /** 需要讀者特別留意的（FOMC、CPI 這類）標記成 alert，用警報橙 */
  alert: boolean
}

// 警報橙只給高重要度的**總經**事件。公司事件（除權息、法說會）即使 importance 是 high
// 也不掛——DESIGN.md 說「用量極少，多了就不是警報」，而權值股除息旺季一週能有十幾筆。
function isAlert(e: CalendarEvent): boolean {
  const isMacro = e.category === undefined || e.category === 'macro'
  return isMacro && e.importance === 'high'
}

/**
 * brief 的 `calendarEvents` → 時間軸帶要的形狀。
 *
 * 超過上限時**不是**直接 slice：先留 alert 事件，再依日期補滿。單純 slice 會在除息旺季
 * 把排在後面的 FOMC 切掉，而那正是這條帶唯一非看不可的東西。輸出一律照日期升冪，
 * 不信賴上游順序。
 */
export function toCalendarBandEvents(events: CalendarEvent[] | undefined): CalendarBandEvent[] {
  if (!events || events.length === 0)
    return []

  const byDate = [...events].sort((a, b) => a.date.localeCompare(b.date))
  const kept = byDate.length <= CALENDAR_BAND_MAX_ITEMS
    ? byDate
    : [
        ...byDate.filter(isAlert).slice(0, CALENDAR_BAND_MAX_ITEMS),
        ...byDate.filter(e => !isAlert(e)),
      ]
        .slice(0, CALENDAR_BAND_MAX_ITEMS)
        .sort((a, b) => a.date.localeCompare(b.date))

  return kept.map(e => ({ date: e.date, title: e.title, alert: isAlert(e) }))
}

/** 時間軸帶下方的一則涵蓋範圍註記；`category` 同時當 v-for 的 key（每類至多一則）。 */
export interface CalendarBandNote {
  category: CalendarCoverage['category']
  text: string
}

// 與 server 端餵給 prompt 的註記行刻意不共用文案：那一份是寫給 LLM 的（帶來源名稱與視窗
// 天數），這一份寫給讀者，只要講清楚一件事——這裡沒列出，不等於當時沒有。
const COVERAGE_CATEGORY_LABELS: Record<CalendarCoverage['category'], string> = {
  'ex-dividend': '除權息',
  'investor-conference': '法說會',
}

function coverageNoteText(c: CalendarCoverage): string {
  const label = COVERAGE_CATEGORY_LABELS[c.category]
  return c.sourceEarliestDate
    ? `${label}：資料來源只涵蓋 ${c.sourceEarliestDate} 之後，這份報告的日期更早，這裡沒列出不代表當時沒有。`
    : `${label}：這份報告的日期早於資料來源涵蓋的範圍，這裡沒列出不代表當時沒有。`
}

/**
 * brief 的 `calendarCoverage` → 時間軸帶要顯示的註記。
 *
 * 只有 out-of-range 的類別才有註記。`unavailable` 刻意不對讀者顯示：server 端把「來源回了
 * 零筆」也判成 unavailable，公司事件的淡季會讓它在正常日子天天出現，那就不是註記而是雜訊。
 * 欄位不存在（較早產出的 brief）**不當成 covered、也不當成任何一種狀態**：我們不知道那份
 * 報告當時的涵蓋情況，所以不替它說話，維持不顯示。
 * 參數刻意不給預設值——呼叫端漏傳要讓 tsc 紅，而不是靜默回空陣列。
 */
export function toCalendarCoverageNotes(coverage: CalendarCoverage[] | undefined): CalendarBandNote[] {
  if (!coverage)
    return []
  return coverage
    .filter(c => c.state === 'out-of-range')
    .map(c => ({ category: c.category, text: coverageNoteText(c) }))
}

/** 「接下來會來的」時間軸帶上的日期格：`07 / 25 六`。無效日期原樣回傳、不印 NaN。 */
export function calendarDayLabel(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m)
    return iso
  const [, y, mo, d] = m
  const dt = new Date(`${iso}T00:00:00Z`)
  // 2026-13-45 這種形狀對、值不對的日期，Date 會回 Invalid Date
  if (Number.isNaN(dt.getTime()) || dt.getUTCFullYear() !== Number(y))
    return iso
  const wd = WEEKDAYS[dt.getUTCDay()] ?? ''
  return `${mo} / ${d} ${wd}`
}
