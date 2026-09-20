import type { OfficialAnnouncementRow } from '@suanomics/db/repos/official-announcements-repo'
import type { CalendarCoverage, SeriesAnchor, SeriesFreshness } from '@suanomics/shared'
import type { EconEvent } from './calendar.js'
import type { SeriesAsOfMap } from './historical-asof.js'
import type { CitableSeries, SeriesLatest } from './snapshot.js'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getLatestPoints } from '@suanomics/db/repos/market-data-repo'
import { getRecentOfficialAnnouncements } from '@suanomics/db/repos/official-announcements-repo'
import { classifyFreshness, taipeiDateOf } from '@suanomics/shared'
import { buildOfficialAnnouncementsBlock, OFFICIAL_BLOCK_SLUGS } from '../brief/official-announcements.js'
import { buildCalendarBlock, CALENDAR_FRESHNESS_MIN_DAYS, CALENDAR_HORIZON_DAYS, COMPANY_CALENDAR_CATEGORY_LABELS, daysUntilCalendarExhausted, EconCalendarSchema, selectCalendarWindow, toDateString } from './calendar.js'
import { fetchExDividendEvents } from './ex-dividend-source.js'
import { fetchInvestorConferenceEvents } from './investor-conference-source.js'
import { SERIES_SPECS } from './series-config.js'
import { buildSnapshotBlock, selectCitableSeries, selectSeriesAnchors } from './snapshot.js'

export interface MarketContext {
  snapshotBlock: string | null
  calendarBlock: string | null
  /**
   * 主管機關一手公告 block（央行／金管會／證交所）。**嚴格說它不是 market data**——
   * 放在這裡是因為 `loadMarketContext` 事實上已經是「brief 的 context block 共用載入器」，
   * 而 editor 與 narrative 兩個呼叫端都已經拿著它；另拉一條平行的載入路徑等於多一份
   * 要各自維護的 degrade 邏輯。命名的錯位是刻意接受的，不是沒看到。
   *
   * 官方公告**不進選稿池**：2026-08-28 實測把它們做成候選丟進真正的 rankAndSelect，
   * 三個日期都是 0/99、0/86、0/77 全被埋（最佳名次第 206、中位第 4,197），
   * 見 `brief/official-announcements.ts` 的檔頭。
   */
  officialBlock: string | null
  taiexCloseDate: string | null
  /**
   * 逐序列的新鮮度。snapshot 掛掉時為空陣列。
   * 會被 pipeline 注入 brief 持久層——`market_data_points.fetched_at` 每輪 refresh 都被推新，
   * 事後現算還原不了「這份報告當時看到的資料有多新」，只能在產出當下記下來。
   */
  dataFreshness: SeriesFreshness[]
  /**
   * 排進 calendarBlock 的同一批事件，未經 markdown 化。
   * 給 pipeline 注入 brief 持久層、讀者面的「接下來會來的」時間軸帶用——讀者面拿不到
   * markdown，而事後重算會把「報告產出後才補上的事件」誤算成當時就在行事曆上。
   * calendar 掛掉時為空陣列（與 calendarBlock 的 null 同一個 degrade）。
   */
  calendarEvents: EconEvent[]
  /**
   * 公司事件（除權息／法說會）各自的來源涵蓋狀態（補產除權息涵蓋狀態這次修正）。除權息來源（TWSE
   * 預告表）沒有日期參數可查歷史，補產舊報告時 reportDate 一旦早於來源涵蓋範圍，
   * 窗內事件是空的——這跟「那週真的沒有除權息」長得一模一樣，過去兩者都被壓成
   * 同一個 `[]`，只 console.warn。這個欄位把兩者分開，讓 buildCalendarBlock 能在
   * 報告上標明「不適用」而不是靜默消失。與 calendarEvents 一樣落地存進 brief——
   * 事後重算會拿「現在」的來源涵蓋範圍去判斷「當時」的窗，兩者不是同一件事。
   */
  calendarCoverage: CalendarCoverage[]
  /**
   * 可被 series evidenceRef 引用的序列。與 snapshotBlock 同一批資料、
   * 且只含 block 裡真的印出數字的序列。snapshot 掛掉時為空陣列（同 dataFreshness 的 degrade）。
   */
  citableSeries: CitableSeries[]
  /**
   * 可被 auto-attach 命中的快照序列點。與 citableSeries 同一批資料，
   * 但**多含前值點且帶數值**——block 也印前值、模型真的會引用。
   * 兩份清單刻意分開：citableSeries 會逐字進 prompt，多列前值就改動了 tier1 prompt。
   */
  seriesAnchors: SeriesAnchor[]
}

interface LoadDeps {
  getLatest?: (seriesId: string, limit: number, asOf?: string) => Promise<{ date: string, value: number }[]>
  readCalendarFile?: () => Promise<string>
  fetchExDividend?: () => Promise<EconEvent[]>
  fetchInvestorConference?: () => Promise<EconEvent[]>
  /** 注入點只為了讓 degrade 分支測得到（同 readCalendarFile 的理由）。 */
  getOfficialAnnouncements?: (windowStart: Date, windowEnd: Date) => Promise<OfficialAnnouncementRow[]>
  now?: Date
  /**
   * 報告日（台北曆日 YYYY-MM-DD）。**必填**：序列新鮮度的期望值以它為基準，
   * 從前這裡有個回退到台北當日的預設，會讓重生舊報告時安靜地用「今天」算期望值。
   */
  reportDate: string
  /**
   * 補跑歷史日期時，逐序列覆寫查詢上界。**per-series、不是單一 `knownAt`**——
   * `market_data_points.fetched_at` 每輪 refresh 都被整批推新，用它反推「當時 DB 有
   * 哪些點」只有 4/26 個序列能重現真值（2026-09-08 本機實測，us-nonfarm-payrolls
   * 甚至被推早成完全不同的月份）。唯一可靠的底本是原版 brief 自己記下來的
   * `dataFreshness[].actualAsOf`（見 `historical-asof.ts`）——逐序列各自的當時 as-of。
   * 不給就是 `processBriefJob`／`brief:generate` 的正常路徑：全部序列用 reportDate。
   */
  seriesAsOf?: SeriesAsOfMap
}

// dev:   apps/server/src/market-data/context.ts → up 2 → apps/server/data/econ-calendar.json
// build: apps/server/dist/market-data/context.js → up 2 → apps/server/data/econ-calendar.json
function defaultCalendarPath(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  return resolve(here, '../../data/econ-calendar.json')
}

/**
 * 全空的 market context。三個呼叫端的 catch 都用它——這個型別加欄位時（這次改動就加了
 * dataFreshness）不必再去找散落的字面量，也不會有某一處漏改卻 compiler 抓不到。
 */
export const EMPTY_MARKET_CONTEXT: MarketContext = {
  snapshotBlock: null,
  calendarBlock: null,
  officialBlock: null,
  taiexCloseDate: null,
  dataFreshness: [],
  calendarEvents: [],
  calendarCoverage: [],
  citableSeries: [],
  seriesAnchors: [],
}

// snapshot 與 calendar 各自獨立 try/catch：market context 是 brief 的「加值」資料、
// 任一邊掛（DB 不通、行事曆檔損毀）都不該讓整個 brief pipeline 倒；degrade 成 null
// 由下游決定要不要拼進 prompt。一邊掛不影響另一邊。
export async function loadMarketContext(deps: LoadDeps): Promise<MarketContext> {
  const getLatest = deps.getLatest ?? getLatestPoints
  const readCalendarFile = deps.readCalendarFile ?? (() => readFile(defaultCalendarPath(), 'utf-8'))
  const now = deps.now ?? new Date()
  const fetchExDividend = deps.fetchExDividend ?? (() => fetchExDividendEvents())
  // 7 天窗的月份要錨在 reportDate、不是 now——補跑舊報告時 now 是「今天」，
  // rocMonthsInWindow(now) 會查到今天所在的民國月份，而 context.ts 下面用 reportDate
  // 算出的視窗（calendarBlock/calendarEvents）只收 reportDate 起算 7 天內的事件，
  // 兩邊基準不一致的結果就是今天抓來的法說會全部落在窗外、被靜默濾掉。
  const fetchInvestorConference = deps.fetchInvestorConference ?? (() => fetchInvestorConferenceEvents({ now: new Date(`${deps.reportDate}T00:00:00Z`) }))

  const snapshot = await loadSnapshot(getLatest, now, deps.reportDate, deps.seriesAsOf)
  const calendar = await loadCalendar(readCalendarFile, fetchExDividend, fetchInvestorConference, now, deps.reportDate)
  const officialBlock = await loadOfficial(deps.getOfficialAnnouncements ?? defaultGetOfficialAnnouncements, deps.reportDate, now)
  return {
    officialBlock,
    snapshotBlock: snapshot.snapshotBlock,
    taiexCloseDate: snapshot.taiexCloseDate,
    dataFreshness: snapshot.dataFreshness,
    citableSeries: snapshot.citableSeries,
    seriesAnchors: snapshot.seriesAnchors,
    calendarBlock: calendar.block,
    calendarEvents: calendar.events,
    calendarCoverage: calendar.coverage,
  }
}

interface SnapshotResult {
  snapshotBlock: string | null
  taiexCloseDate: string | null
  dataFreshness: SeriesFreshness[]
  citableSeries: CitableSeries[]
  seriesAnchors: SeriesAnchor[]
}

async function loadSnapshot(
  getLatest: NonNullable<LoadDeps['getLatest']>,
  now: Date,
  reportDate: string,
  seriesAsOf: SeriesAsOfMap | undefined,
): Promise<SnapshotResult> {
  try {
    const latest: SeriesLatest[] = await Promise.all(
      SERIES_SPECS.map(async (spec) => {
        // 逐序列覆寫優先於 reportDate。**用 `in` 判斷 key 是否存在，不用 `??`**——
        // `null` 是合法覆寫值（代表「當時這條序列一個點都沒有」），`??` 會把它當成
        // 「沒有覆寫」而誤退回 reportDate、重新引入這次改動要修的漂移。
        if (seriesAsOf !== undefined && spec.seriesId in seriesAsOf) {
          const override = seriesAsOf[spec.seriesId]
          if (override === null)
            return { spec, points: [] }
          return { spec, points: await getLatest(spec.seriesId, 2, override) }
        }
        // 沒有覆寫：上界錨在 reportDate，理由與官方公告那條窗相同——補跑歷史日期時，
        // 報告日之後的點不該進得了快照（`getLatestPoints` 的 docblock 有案例）。
        return { spec, points: await getLatest(spec.seriesId, 2, reportDate) }
      }),
    )
    const taiex = latest.find(item => item.spec.seriesId === 'taiex-close')
    return {
      snapshotBlock: buildSnapshotBlock(latest, now, reportDate),
      taiexCloseDate: taiex?.points[0]?.date ?? null,
      citableSeries: selectCitableSeries(latest, now, reportDate),
      seriesAnchors: selectSeriesAnchors(latest, now, reportDate),
      dataFreshness: latest.map(item => classifyFreshness({
        seriesId: item.spec.seriesId,
        rule: item.spec.freshness,
        reportDate,
        actualAsOf: item.points[0]?.date ?? null,
      })),
    }
  }
  catch (err) {
    console.warn('[market-context] snapshot block 載入失敗、degrade 成 null：', err)
    return { snapshotBlock: null, taiexCloseDate: null, dataFreshness: [], citableSeries: [], seriesAnchors: [] }
  }
}

interface CompanyEventsResult {
  events: EconEvent[]
  /**
   * 抓取是否 throw。與「回了 0 筆」分開記——resolveCalendarCoverage 兩者都判 unavailable，
   * 但 console.warn 的文字要能講清楚是哪一種。
   */
  failed: boolean
}

// 單一公司源抓取包 try/catch：一個掛不影響另一個、也不影響 macro；失敗 warn + 回 []。
// 回傳形狀帶 failed（這次修正前只回 EconEvent[]）：呼叫端要能分辨「抓取失敗」與
// 「抓到但這次真的是 0 筆」，兩者過去被壓成同一個 `[]`、resolveCalendarCoverage 就是
// 靠這個欄位才分得出 unavailable。
async function loadCompanyEvents(
  fetch: () => Promise<EconEvent[]>,
  label: string,
): Promise<CompanyEventsResult> {
  try {
    return { events: await fetch(), failed: false }
  }
  catch (err) {
    console.warn(`[market-context] ${label} 抓取失敗、該類標成 unavailable 並在報告上附註記：`, err)
    return { events: [], failed: true }
  }
}

/**
 * 純函式：從抓取結果推出來源涵蓋狀態（補產除權息涵蓋狀態這次修正）。刻意不用「reportDate 比今天早」
 * 這種猜時鐘的判準——那種判準測試要 mock 時鐘、且來源自己延遲發布時會誤判；「窗尾有沒有
 * 落在來源涵蓋範圍內」可以直接從抓回來的資料自己推。
 *
 * - failed 或回 0 筆：什麼都判斷不出來 → unavailable。
 * - !supportsHistory 且整個窗都在來源最早一筆之前 → out-of-range（帶來源最早日期）。
 * - 其餘 → covered（窗內零事件是真資訊，不是抓取問題）。
 *
 * `windowEnd` 必須用跟 selectCalendarWindow 同一個日期加法算出來（見呼叫端的 toDateString），
 * 不要在這裡另外重算一次視窗尾端。
 */
export function resolveCalendarCoverage(
  category: CalendarCoverage['category'],
  result: CompanyEventsResult,
  windowEnd: string,
  supportsHistory: boolean,
): CalendarCoverage {
  if (result.failed || result.events.length === 0)
    return { category, state: 'unavailable', sourceEarliestDate: null }

  const earliest = result.events
    .map(e => e.date)
    .reduce((min, d) => (d < min ? d : min))

  if (!supportsHistory && windowEnd < earliest)
    return { category, state: 'out-of-range', sourceEarliestDate: earliest }

  return { category, state: 'covered', sourceEarliestDate: null }
}

// block 給 prompt、events 給讀者面。兩者出自同一次載入與同一個視窗函式，
// 不可能出現「LLM 看到的行事曆」與「讀者看到的行事曆」不一致。
async function loadCalendar(
  readCalendarFile: NonNullable<LoadDeps['readCalendarFile']>,
  fetchExDividend: NonNullable<LoadDeps['fetchExDividend']>,
  fetchInvestorConference: NonNullable<LoadDeps['fetchInvestorConference']>,
  now: Date,
  reportDate: string,
): Promise<{ block: string | null, events: EconEvent[], coverage: CalendarCoverage[] }> {
  let macroEvents: EconEvent[]
  try {
    const raw = await readCalendarFile()
    const parsed = EconCalendarSchema.parse(JSON.parse(raw))
    // 種子將盡告警：與「視窗空是正常」區別——這裡是整個種子庫存快耗盡（異常、需補種子）。
    const daysLeft = daysUntilCalendarExhausted(parsed.events, now)
    if (daysLeft < CALENDAR_FRESHNESS_MIN_DAYS) {
      console.warn(
        `[market-context] econ-calendar 種子將盡：最遠事件距今 ${daysLeft} 天 `
        + `< ${CALENDAR_FRESHNESS_MIN_DAYS}、請補種子或接自動源`,
      )
    }
    macroEvents = parsed.events
  }
  catch (err) {
    console.warn('[market-context] calendar 種子載入失敗、degrade 成無 macro 事件：', err)
    macroEvents = []
  }

  // 公司事件各自獨立 degrade（一個掛不拖累另一個、也不拖累 macro）。
  // label 借用 calendar.ts 的中文名對照，不在這裡另寫一份字面量。
  const [exDiv, conf] = await Promise.all([
    loadCompanyEvents(fetchExDividend, COMPANY_CALENDAR_CATEGORY_LABELS['ex-dividend']),
    loadCompanyEvents(fetchInvestorConference, COMPANY_CALENDAR_CATEGORY_LABELS['investor-conference']),
  ])

  // 視窗內兩類皆無時 buildCalendarBlock 回 null、selectCalendarWindow 回 []（正常、不 warn）。
  //
  // ★ 窗的錨點是 **reportDate**、不是 now，理由與序列快照、官方公告那兩塊相同：補跑歷史
  //   報告時 now 是「今天」，用它算窗會印出今天起算的未來七天，而這份 events 會被寫進
  //   brief 持久層給讀者面看。錨成報告日當天的 UTC 午夜，`toDateString` 取回來就逐字是
  //   reportDate（reportDate 是台北曆日，用 now 另外還有 UTC/台北 差一天的漂移）。
  //   健康度 warn 用的仍是 now：「種子還夠用幾天」問的是現在，不是報告日。
  const all = [...macroEvents, ...exDiv.events, ...conf.events]
  const anchor = new Date(`${reportDate}T00:00:00Z`)
  // windowEnd 必須跟 selectCalendarWindow 用同一個日期加法（見 calendar.ts 的 toDateString
  // export 理由）——否則 out-of-range 的判準會跟 buildCalendarBlock 實際採用的視窗不一致。
  const windowEnd = toDateString(new Date(anchor.getTime() + CALENDAR_HORIZON_DAYS * 24 * 60 * 60 * 1000))
  const coverage: CalendarCoverage[] = [
    resolveCalendarCoverage('ex-dividend', exDiv, windowEnd, false),
    resolveCalendarCoverage('investor-conference', conf, windowEnd, true),
  ]
  return {
    block: buildCalendarBlock(all, anchor, CALENDAR_HORIZON_DAYS, coverage),
    events: selectCalendarWindow(all, anchor),
    coverage,
  }
}

/** 官方公告的回溯窗。合計約 5 則/日，3 天 ≈ 15 則，再由 block 的 limit 收到 10。 */
const OFFICIAL_WINDOW_DAYS = 3

function defaultGetOfficialAnnouncements(windowStart: Date, windowEnd: Date): Promise<OfficialAnnouncementRow[]> {
  return getRecentOfficialAnnouncements(OFFICIAL_BLOCK_SLUGS, windowStart, windowEnd)
}

/**
 * 官方公告 block。自帶 try/catch，理由與 snapshot／calendar 那兩塊相同：它是加值資料，
 * DB 不通不該讓整個 brief 倒；degrade 成 null，下游據此整段不放進 prompt。
 */
async function loadOfficial(
  fetchRows: (windowStart: Date, windowEnd: Date) => Promise<OfficialAnnouncementRow[]>,
  reportDate: string,
  now: Date,
): Promise<string | null> {
  try {
    // ★ 錨在 reportDate 不是 now：重生歷史報告時 now 是「今天」，用它算窗會把報告日
    // 之後才發布的公告一起撈進來（同 getRelevanceCandidates 的上下界理由）。
    // ★ 界線是**台北日界**。台灣沒有日光節約，所以 +08:00 是常數，可以直接寫進字串；
    // 用 UTC 日界的話，證交所那批固定落在 16:00Z（台北隔日 00:00）的公告會被算進前一天。
    const end = new Date(`${reportDate}T23:59:59.999+08:00`)
    const startDay = new Date(new Date(`${reportDate}T00:00:00+08:00`).getTime() - OFFICIAL_WINDOW_DAYS * 864e5)
    const start = new Date(`${taipeiDateOf(startDay)}T00:00:00+08:00`)
    const rows = await fetchRows(start, end)
    return buildOfficialAnnouncementsBlock(rows, { now })
  }
  catch (err) {
    console.warn('[market-context] 官方公告載入失敗、degrade 成 null:', err)
    return null
  }
}
