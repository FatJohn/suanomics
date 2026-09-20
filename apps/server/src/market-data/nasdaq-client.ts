import type { SeriesSpec } from './series-config.js'
import type { RawPoint } from './transform.js'
import { fetchSource } from './fetch-source.js'

const NASDAQ_QUOTE_BASE = 'https://api.nasdaq.com/api/quote'
const MS_PER_DAY = 86_400_000
const QUERY_WINDOW_DAYS = 14
const QUERY_LIMIT = 10

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null
}

// 端點日期為美式 MM/DD/YYYY（如 07/30/2026）；非該格式或非真實曆日回 null 由 caller 跳過該列。
// 之所以不能只驗位數：'13/45/2026' 這種會拼成 '2026-13-45'，兩層後果都很糟——
// 進 upsertMarketDataPoints 時 Postgres 的 date 欄會讓**整批 INSERT 炸掉**
// （同一次回應裡的合法列一起丟失，違背逐列 skip 的設計意圖）；而若真落地，
// snapshot 的 calendarDaysBetween 會回 NaN、`NaN > 5` 為 false，於是**繞過**過期守衛。
function toIsoDate(raw: unknown): string | null {
  if (typeof raw !== 'string')
    return null
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw.trim())
  if (!m)
    return null
  const [, mm = '', dd = '', yyyy = ''] = m
  // Date 建構會把溢位值靜默 roll over（2 月 30 日 → 3 月 2 日），所以要拿回讀的欄位
  // 跟原字串比對：對不上就代表原字串不是真實曆日。
  const d = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)))
  const sameDay = d.getUTCFullYear() === Number(yyyy)
    && d.getUTCMonth() === Number(mm) - 1
    && d.getUTCDate() === Number(dd)
  return sameDay ? `${yyyy}-${mm}-${dd}` : null
}

// 嚴格十進位形狀：可選負號 + 千分位分組或純數字 + 可選小數。
// 之所以不能把字串直接丟給 Number()：`Number('')`／`Number(' ')` 都是 **0** 且
// `Number.isFinite(0)` 為 true，空字串收盤價不會被跳過、會靜默變成「0 點」印進已發布
// 的報告與讀者面數字卡片（實測：費半 0 點、-100%）。同一個 root cause 還讓 '0x1F' → 31、
// '1e5' → 100000、歐系格式 '11.302,99' 去逗號後 → 11.30299（差 1000 倍且為有限值）照樣通過。
const DECIMAL_SHAPE = /^-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/

// 指數 close 帶千分位、無 $ 前綴（個股才有）；「--」等佔位字串回 null 由 caller 跳過。
function toNumber(raw: unknown): number | null {
  if (typeof raw !== 'string')
    return null
  const s = raw.trim().replace(/^\$/, '')
  if (!DECIMAL_SHAPE.test(s))
    return null
  const n = Number(s.replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

/**
 * 解析 `/api/quote/{symbol}/historical` 回應。三種實測情境的分辨關鍵：
 * - 正常交易日：`data.tradesTable.rows[]`
 * - 查詢窗內無交易日（週末／連假）：`data` 存在但 `tradesTable` 為 `null`——
 *   **`rows` 這個 key 根本不存在**，故必須用 optional chaining，寫成 `rows: null` 會 TypeError。
 *   這是端點的正常回應、回 `[]` graceful degrade。
 * - 錯誤符號：`data` 整個為 `null`（`rCode` 400、但 **HTTP 仍是 200**，故不能靠 status code 判）。
 *   這是設定錯誤（symbol 打錯），要 throw 讓 refresh 計入 failures、不可靜默當成沒資料。
 */
export function parseNasdaqHistorical(body: unknown, symbol: string): RawPoint[] {
  const root = asRecord(body)
  const data = asRecord(root?.data)
  if (!data) {
    const rCode = asRecord(root?.status)?.rCode
    throw new Error(`nasdaq-client: ${symbol} returned no data (rCode ${String(rCode)})`)
  }

  // 端點對 symbol 很寬鬆：實測 'sox'（小寫）與 'SOX%20'（尾隨空白）都回 200 並照抄 SOX 資料，
  // 所以回應自帶的 symbol 是唯一能確認「拿到的是不是我要的那檔」的守衛。不符代表設定或端點
  // 異常（fuzzy match、代碼遷移），要吵——靜默存進去就是別的指數的點位冒充本序列。
  // 空窗回應的 symbol 是 null（非字串），那條路徑不受此檢查影響、維持回 []。
  const responseSymbol = data.symbol
  if (typeof responseSymbol === 'string' && responseSymbol.trim().toUpperCase() !== symbol.trim().toUpperCase())
    throw new Error(`nasdaq-client: ${symbol} response symbol mismatch (got ${responseSymbol})`)

  const tradesTable = asRecord(data.tradesTable)
  if (!tradesTable)
    return []

  const rows = tradesTable.rows
  if (!Array.isArray(rows)) {
    console.warn(`[nasdaq-client] ${symbol}: tradesTable.rows is not an array — shape drift?`)
    return []
  }

  return rows.flatMap((row) => {
    const r = asRecord(row)
    const date = toIsoDate(r?.date)
    const value = toNumber(r?.close)
    return date !== null && value !== null ? [{ date, value }] : []
  })
}

// `+119.27` 這種帶正號的字串：DECIMAL_SHAPE 只允許可選負號，故先剝掉正號再走同一套嚴格檢查。
function toSignedNumber(raw: unknown): number | null {
  return typeof raw === 'string' ? toNumber(raw.trim().replace(/^\+/, '')) : null
}

const MONTH_ABBR: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
}

// `/info` 的 lastTradeTimestamp 是 `"Aug 3, 2026"`（月份縮寫、日無前導零）。
// 刻意不用 `new Date(str)`：它會依 **local timezone** 解讀，在台北時區跨日錯位一天；
// 而且對 `'Feb 30, 2026'` 會靜默 roll over 成 3/2。這裡查表組 UTC 曆日再回讀比對，兩個坑一起堵。
// 形狀不符一律回 null（例如盤中可能出現的 `"Aug 4, 2026 4:15 PM ET"` 變體）——寧可不疊。
function toIsoDateFromInfoTimestamp(raw: unknown): string | null {
  if (typeof raw !== 'string')
    return null
  const m = /^([a-z]{3}) (\d{1,2}), (\d{4})$/i.exec(raw.trim())
  if (!m)
    return null
  const [, mon = '', dd = '', yyyy = ''] = m
  const month = MONTH_ABBR[mon.toLowerCase()]
  if (month === undefined)
    return null
  const day = Number(dd)
  const d = new Date(Date.UTC(Number(yyyy), month - 1, day))
  const sameDay = d.getUTCFullYear() === Number(yyyy) && d.getUTCMonth() === month - 1 && d.getUTCDate() === day
  return sameDay ? `${yyyy}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` : null
}

/** `/info` 解析出的單一最新點；`impliedPrevClose` 供疊加前的一致性檢查用。 */
export interface NasdaqInfoPoint { date: string, value: number, impliedPrevClose: number }

// `marketStatus` 追蹤的是**延長時段**，不是「日線收盤與否」。
//
// 端點實測回過的值有三個：`Closed`、`Pre-Market`、`After-Hours`。`Open` 沒有實測紀錄——
// 它在 repo 裡出現的地方（`nasdaq-overlay-smoke.ts` 的合成反例、本模組的測試、
// smoke 輸出存檔）全是我們自己構造的字串，是依盤中語意推的名字。
// 推測的狀態機是 `Closed` →（04:00 ET）`Pre-Market` →（09:30）`Open` →（16:00）`After-Hours`
// →（20:00）`Closed`，但**只有 04:00 那個轉換被實際觀測過**（2026-08-06 的 26 個樣本，
// ET 04:01:40 翻轉）；其餘邊界與時刻都是推的。不要把整張圖當成實測。
//
// 只有這兩個值收：
// - `Closed`：當然。
// - `After-Hours`：**這是推論，不是實測**——指數不是可交易個股，所以延長時段的 `lastSalePrice`
//   應該就是收盤值。手上兩個證據都不直接支持它：04:01:40 那組測的是**早上**的時段轉換，
//   而 2026-08-07 ET 17:53 抓到的 `ts` 是**日粒度**，看不出盤中有沒有跳動。
//   （後者證明的是 `/info` 在該時刻已翻到當日，也就是沿用 T-1 事故的成因，見 parseNasdaqInfo 的註解。）
//
// **已知殘留風險（16:00 ET 邊界）**：上面的推論在「剛翻成 `After-Hours` 的那幾分鐘」最弱——
// 收盤競價結算完成之前 `lastSalePrice` 是否已定案，沒有人觀測過，而且連「幾分鐘」都是猜的。
// 手動觸發的 market-data refresh 落在那個窗就會踩到，把最後一跳當成收盤寫進序列。
//
// **排程路徑的餘裕會隨夏令時間縮水，冬天要重新評估**：若排程在 21:10 UTC 觸發，
// 夏令（EDT）是 ET 17:10、冬令（EST）是 **ET 16:10**，離收盤只有 10 分鐘。用系統 cron 或延遲
// 接近 0 的 scheduler，冬令這 10 分鐘餘裕就是全部、沒有別的東西在幫忙；若用 GitHub Actions
// 的 cron，實測延遲約 58–70 分（偶有數小時離群，見下方 2026-08-06／08-07 那組數字），這個延遲
// 客觀上拉開了收盤後的餘裕，但那是延遲在幫忙、不是設計保證。
// **11 月換冬令之前，排程者要嘛實際去量收盤後那幾分鐘、要嘛把觸發時間往後推。**
//
// 踩到時有兩層緩衝：upsert 是 do-update，隔日 `/historical` 會覆蓋自癒；但當晚已發布的
// brief 會帶著錯值。要根治得實際觀測，別再用對稱性補上——上次事故栽的就是這個。
//
// **刻意用白名單而非「只擋 Open」的黑名單**：端點沒有文件，未來新增或改寫狀態值時，
// 白名單會退回現行行為並 warn，黑名單則會默默放行一個沒人看過的狀態。
// 同理逐字比對不做正規化——`After Hours`（空格）這種近似值要吵，不要猜。
const ACCEPTED_MARKET_STATUSES = new Set(['Closed', 'After-Hours'])

/**
 * 解析 `/api/quote/{symbol}/info` 回應。這一層**永遠不 throw**：它是疊加層，
 * throw 會讓整條序列進 refresh 的 failures、連已經抓到的 historical 點一起丟掉，比現況更糟。
 * 任何看不懂的形狀都回 null（＝不疊，退回現行行為）。
 *
 * `marketStatus` 是硬 gate 且位於 `data` 這一層（**不在 primaryData 裡**）：盤中的 lastSalePrice
 * 是即時價，寫進日線序列就是假收盤價。這一道被拒絕時會 warn 並印出實際字串（2026-08-06 改）。
 *
 * **沿用 T-1 事故的成因就是這一道**，2026-08-07 prod 實測抓到（ET 週五 17:53，觸發延遲 43 分）：
 * `marketStatus=After-Hours`、`ts=Aug 7, 2026`、`/historical` 最新只到 08-06。原本只認 `Closed`，
 * 於是每個交易日都在延長時段被擋掉，`us-sox`／`us-nasdaq-comp` 沿用 T-1 收盤。
 * 若排程排在 21:10 UTC（夏令 ET 17:10、冬令 ET 16:10），加上當時用 GitHub Actions cron 觸發的延遲
 * （實測 07-20 至 08-05 的 17 次落在 58–70 分，08-07 為 43 分，08-06 曾離群到 3h51m），
 * 落點在夏令幾乎必然在 ET 16:00–20:00 這個延長時段裡；只有 08-06 那次離群延遲把它推到
 * 20:00 之後，`marketStatus` 回到 `Closed`、疊加就成功了——這也是成因的反證。
 */
export function parseNasdaqInfo(body: unknown, symbol: string): NasdaqInfoPoint | null {
  const data = asRecord(asRecord(body)?.data)
  if (!data) {
    console.warn(`[nasdaq-client] ${symbol}: /info returned no data — skip overlay`)
    return null
  }

  const responseSymbol = data.symbol
  if (typeof responseSymbol === 'string' && responseSymbol.trim().toUpperCase() !== symbol.trim().toUpperCase()) {
    console.warn(`[nasdaq-client] ${symbol}: /info symbol mismatch (got ${responseSymbol}) — skip overlay`)
    return null
  }

  const status = data.marketStatus
  if (typeof status !== 'string' || !ACCEPTED_MARKET_STATUSES.has(status)) {
    const ts = asRecord(data.primaryData)?.lastTradeTimestamp
    console.warn(`[nasdaq-client] ${symbol}: /info marketStatus=${String(status)} (not accepted) ts=${String(ts)} — skip overlay`)
    return null
  }

  const primary = asRecord(data.primaryData)
  if (!primary) {
    console.warn(`[nasdaq-client] ${symbol}: /info has no primaryData — shape drift?`)
    return null
  }

  const date = toIsoDateFromInfoTimestamp(primary.lastTradeTimestamp)
  const value = toNumber(primary.lastSalePrice)
  const netChange = toSignedNumber(primary.netChange)
  if (date === null || value === null || netChange === null) {
    console.warn(`[nasdaq-client] ${symbol}: /info unparseable (ts=${String(primary.lastTradeTimestamp)} price=${String(primary.lastSalePrice)} netChange=${String(primary.netChange)}) — skip overlay`)
    return null
  }

  return { date, value, impliedPrevClose: value - netChange }
}

// 一致性檢查的容差：兩個端點若真的不同步，差距是幾十到幾百點，不是這個數量級；
// 這裡只需要吸收浮點尾差與末位進位差異。
function closeEnough(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(0.01, Math.abs(b) * 1e-6)
}

// 疊加點與序列最新列的曆日上界。沒有這個上界，端點若吐出 `"Aug 3, 9999"` 配上正確的
// 價格與 netChange，一致性檢查會照樣放行，而那一點會永遠是序列的「最新」值。
//
// 7 是**美股史上最長停市**的實際天數，不是留了餘裕的整數：9/11 最後交易日 2001-09-10、
// 復市 2001-09-17，恰好 7 天，且比較是嚴格大於故剛好放行。其餘量級：Sandy 5 天
// （2012-10-26 → 10-31）、假日長週末 4 天、常態 1 天（週二到週五）或 3 天（週一補週五）。
// **不要「順手」收緊到 6**——那會砍掉 9/11 級的情境；要動這個值先重算上面三個日期。
const MAX_OVERLAY_GAP_DAYS = 7

function calendarDaysBetween(fromIso: string, toIso: string): number {
  return (Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / MS_PER_DAY
}

/**
 * 把 `/info` 的最新點疊到 `/historical` 序列上——**若且唯若**它比序列最新一列更新、
 * 落在合理的日期窗內，且它推得的前值對得上該最新列的收盤。任何一條不成立都 degrade
 * 而非硬寫入。
 *
 * historical 為空時沒有錨點可比，一律不疊（14 天窗全無交易日本來就已是 graceful degrade 路徑）。
 * 端點回的順序是新到舊，但那是實作細節不是契約，所以錨點真的算 max。
 *
 * 已知殘留風險：這裡只確認「更新」，沒有確認「是下一個交易日」（要根治得引進美股交易日曆）。
 * 若 historical 落後兩個交易日、且中間那天的收盤恰好與錨點在小數兩位上相同，會疊上 T 日
 * 而留下 T-1 空洞。日期窗把影響侷限在一個長週末內，其餘接受。
 */
export function overlayInfoPoint(historical: RawPoint[], info: NasdaqInfoPoint | null): RawPoint[] {
  if (!info || historical.length === 0)
    return historical

  const latest = historical.reduce((a, b) => (a.date >= b.date ? a : b))
  if (info.date <= latest.date)
    return historical

  const gapDays = calendarDaysBetween(latest.date, info.date)
  if (!Number.isFinite(gapDays) || gapDays > MAX_OVERLAY_GAP_DAYS) {
    console.warn(`[nasdaq-client] /info date ${info.date} is ${gapDays} days after historical ${latest.date} — implausible gap, skip overlay`)
    return historical
  }

  if (!closeEnough(info.impliedPrevClose, latest.value)) {
    console.warn(`[nasdaq-client] /info prev close ${info.impliedPrevClose} != historical ${latest.date} close ${latest.value} — endpoints out of sync, skip overlay`)
    return historical
  }

  return [{ date: info.date, value: info.value }, ...historical]
}

function latestDateOf(points: RawPoint[]): string | null {
  return points.reduce<string | null>((acc, p) => (acc === null || p.date > acc ? p.date : acc), null)
}

/**
 * 只要疊加真的被嘗試過就印一行結果。**這一行的存在理由是「沉默的成功」與「沉默的失敗」
 * 在 prod log 裡長得一模一樣。**
 *
 * 兩條仍然靜默的跳過路徑：`historical` 為空（查詢窗無交易日，`parseNasdaqHistorical` 回 `[]`
 * 而不 warn），以及 `info.date <= latest.date`（序列已自己補齊）。這兩條與「順利疊上去」
 * 一樣不留痕——於是 log 裡沒有 `[nasdaq-client]` 行時，無法分辨疊加成功還是被跳過。
 * 這次事故（`us-sox`／`us-nasdaq-comp` 每天沿用 T-1）因此撐過三個 session 都指認不出是哪一道
 * 擋的：唯一的觀測手段是等下一個交易日、再賭一次守衛剛好留下訊息。
 * （第三條是 `marketStatus` 不在白名單，它原本也靜默；2026-08-06 起已單獨改成 warn，
 * 而那行 warn 正是 2026-08-07 印出 `After-Hours` 收掉那次事故的那一行。）
 *
 * 印 rows 數、historical 最新日、info 日與結果最新日這四項，是因為它們能把路徑分開讀：
 * `historical 0 rows` ＝第一條、`info` 日不大於 historical 最新日 ＝第二條、
 * `info none` ＝ `/info` 那側被擋，**是哪一道要配同批 log 裡的 warn 讀**（六個成因全都會 warn，
 * 但這行本身分不出是哪一個；gap 與 prevclose 兩道的結果行形狀也相同，同樣靠 warn 區分）。
 *
 * 唯一印不出來的情況是 `/historical` 自己 throw（非 200、timeout、rCode 400、symbol 不符）——
 * 那時整條序列進 `refreshMarketData` 的 failures，痕跡在 `refresh.ts` 的 warn 而不在這裡。
 * 每天兩行（SOX／COMP），噪音可忽略。
 */
function logOverlayOutcome(symbol: string, historical: RawPoint[], info: NasdaqInfoPoint | null, result: RawPoint[]): void {
  // overlayInfoPoint 只有兩種結果：原樣回傳，或在最前面補一點；故長度變化即等同「有沒有疊」。
  const verdict = result.length > historical.length ? 'overlaid' : 'not overlaid'
  // eslint-disable-next-line no-console -- 這是正常結果不是降級，用 warn 會讓每天兩行常態輸出混進告警視野
  console.log(
    `[nasdaq-client] ${symbol}: overlay outcome — historical ${historical.length} rows `
    + `(latest ${latestDateOf(historical) ?? 'none'}), info ${info?.date ?? 'none'}, `
    + `result latest ${latestDateOf(result) ?? 'none'} → ${verdict}`,
  )
}

// 查詢窗刻意用 UTC 曆日（比照 taifex-client）：UTC 落後台北 8 小時，台北清晨的 pipeline
// 對到的 UTC 日期恰好就是要抓的那個美國交易日。14 天窗穩健涵蓋長假。
function formatIsoDate(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// **必須帶 User-Agent**：實測不帶時連線直接失敗（curl http_code=000），不是 4xx。
async function fetchNasdaqJson(url: string, symbol: string, timeoutMs: number): Promise<unknown> {
  return fetchSource(url, {
    label: `nasdaq-client: ${symbol}`,
    timeoutMs,
    init: { headers: { 'User-Agent': 'Mozilla/5.0' } },
  })
}

/**
 * 抓單一 Nasdaq 指數日線序列（sourceCode = Nasdaq symbol，如 SOX / COMP）。
 *
 * 兩段式：`/historical` 是序列主體，但該表在美股收盤後**延遲約 7–11 小時**才補上
 * 當日列，而 pipeline 在收盤後 2.5 小時就跑完——直接用等於每個週二到週五都沿用 T-2 收盤。
 * 所以再抓一次 `/info` 拿當日收盤疊上去。`/info` 只有單一最新點、無歷史也無前值，
 * 故只能疊加、不能取代（`buildKeyNumbers` 需要 previous 算 delta、序列本身也需要 backfill）。
 *
 * - 非 200 throw（caller 計入 failures）；查詢窗無交易日由 parse 判成 []
 * - **`/info` 整段包在 try/catch 裡**：疊加層只能讓結果變好、不能讓結果比現況更糟。
 * - 未文件化的第一方端點：每日僅抓一次、不重試轟炸，解析失敗一律 graceful degrade。
 */
export async function fetchNasdaqSeries(spec: SeriesSpec, now: Date = new Date(), timeoutMs = 15_000): Promise<RawPoint[]> {
  const symbol = spec.sourceCode
  const todate = formatIsoDate(now)
  const fromdate = formatIsoDate(new Date(now.getTime() - QUERY_WINDOW_DAYS * MS_PER_DAY))
  const historicalUrl = `${NASDAQ_QUOTE_BASE}/${encodeURIComponent(symbol)}/historical`
    + `?assetclass=index&fromdate=${fromdate}&todate=${todate}&limit=${QUERY_LIMIT}`

  const historical = parseNasdaqHistorical(await fetchNasdaqJson(historicalUrl, symbol, timeoutMs), symbol)

  const infoUrl = `${NASDAQ_QUOTE_BASE}/${encodeURIComponent(symbol)}/info?assetclass=index`
  let info: NasdaqInfoPoint | null = null
  try {
    info = parseNasdaqInfo(await fetchNasdaqJson(infoUrl, symbol, timeoutMs), symbol)
  }
  catch (err) {
    console.warn(`[nasdaq-client] ${symbol}: /info fetch failed — serving historical only:`, err instanceof Error ? err.message : String(err))
  }

  const result = overlayInfoPoint(historical, info)
  logOverlayOutcome(symbol, historical, info, result)
  return result
}
