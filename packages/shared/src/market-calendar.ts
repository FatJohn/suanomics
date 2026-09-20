import { z } from 'zod'

/**
 * 行事曆事件的單一真相。
 *
 * 為什麼在 shared 而不是 worker：worker 用它 parse 種子檔與公司事件源，brief 把視窗內的
 * 事件原封存進 briefJson，讀者面再拿它渲染「接下來會來的」時間軸帶。三端共用同一個形狀，
 * 任何一端加欄位而另外兩端沒跟上時 tsc 會擋。
 *
 * `category` 未指定或 `macro` 視為總經事件；`ex-dividend` / `investor-conference` 是公司事件。
 * 這個預設值語意是歷史遺留（種子檔早於公司事件），不要反過來把 macro 設成必填。
 */
export const CalendarEventSchema = z.object({
  /** ISO `YYYY-MM-DD`。一律用字串比較避免跨時區位移。 */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  title: z.string().min(1),
  region: z.enum(['US', 'TW', 'GLOBAL']),
  importance: z.enum(['high', 'medium', 'low']),
  category: z.enum(['macro', 'ex-dividend', 'investor-conference']).optional(),
  companyCode: z.string().optional(),
})

export type CalendarEvent = z.infer<typeof CalendarEventSchema>

/** category 未指定或 'macro' 視為總經事件；其餘為公司事件。 */
export function isCompanyCalendarEvent(e: CalendarEvent): boolean {
  return e.category === 'ex-dividend' || e.category === 'investor-conference'
}

/**
 * 公司事件來源的涵蓋狀態（補產除權息涵蓋狀態這次修正）。
 *
 * 為什麼要分三態、不只是「有資料/沒資料」：除權息來源（TWSE 預告表）沒有日期參數可查
 * 歷史，只列「從今天往後」即將發生的事件。補產舊報告時，reportDate 一旦早於來源涵蓋
 * 範圍，窗內自然是空的——這跟「那週剛好沒有除權息」在資料形狀上長得一模一樣，過去兩者
 * 都被壓成同一個 `[]`。三態把「這句話能不能信」跟「事件是不是真的沒有」分開：
 * - covered：來源有回應、且窗與來源範圍有交集 → 窗內零事件是真資訊。
 * - out-of-range：來源有回應，但整個窗都在來源涵蓋範圍之前 → 補產超出來源射程，
 *   窗內零事件不代表那週真的沒事，不能直接拿來當「沒有」用。
 * - unavailable：抓取失敗，或來源回了零筆（連判斷涵蓋範圍的依據都沒有）。
 */
export const CalendarCoverageStateSchema = z.enum(['covered', 'out-of-range', 'unavailable'])
export type CalendarCoverageState = z.infer<typeof CalendarCoverageStateSchema>

export const CalendarCoverageSchema = z.object({
  /** 對應 CalendarEvent.category 的公司事件類別。 */
  category: z.enum(['ex-dividend', 'investor-conference']),
  state: CalendarCoverageStateSchema,
  /** out-of-range 時來源最早一筆的日期（YYYY-MM-DD），給註記行說明射程；其餘狀態為 null。 */
  sourceEarliestDate: z.string().nullable(),
})
export type CalendarCoverage = z.infer<typeof CalendarCoverageSchema>
