import type { SeriesSpec } from './series-config.js'
import type { RawPoint } from './transform.js'
import { fetchSource, SOURCE_TIMEOUT_MS } from './fetch-source.js'

const TWSE_OPENAPI_BASE = 'https://openapi.twse.com.tw'

// 兩種 TWSE 來源：
// - OpenAPI（openapi.twse.com.tw）：回傳「物件陣列」、欄位皆為字串（FMTQIK）。
// - 傳統 JSON API（www.twse.com.tw/rwd）：回傳 `{stat, date, fields, data}` 物件、
//   data 為 row array、欄位以 fields index 對照（BFI82U / MI_MARGN）。
// 故 fetch 與 parse 分離：fetch 只負責 HTTP + JSON、parse 各自對應 dataset shape。

/**
 * 拉單一 TWSE dataset。
 * - `sourceCode` 以 `http` 開頭時視為完整 URL（傳統 JSON API）；否則前綴 OpenAPI base。
 * - 逾時、非 200 與 AbortError 轉譯由 `fetchSource` 統一負責（錯誤訊息含 endpoint）
 * - 回傳 raw JSON body（array 或 object）、由各 parser 自行解讀 shape。
 */
export async function fetchTwseDataset(endpoint: string, timeoutMs = SOURCE_TIMEOUT_MS): Promise<unknown> {
  const url = endpoint.startsWith('http') ? endpoint : `${TWSE_OPENAPI_BASE}${endpoint}`
  return fetchSource(url, { label: `twse-client: ${endpoint}`, timeoutMs })
}

/**
 * TWSE 日期 → ISO `YYYY-MM-DD`。
 * 支援三種輸入：
 * - 民國斜線 `115/06/11`
 * - 民國 yyyymmdd（7 碼、FMTQIK 的 `Date` 欄如 `1150611`）
 * - 西元 yyyymmdd（8 碼、`20260611`）
 * 民國年 + 1911 = 西元年。
 */
export function parseRocDate(raw: string): string {
  const s = raw.trim()
  if (s.includes('/')) {
    const [y, m, d] = s.split('/')
    return `${Number(y) + 1911}-${m?.padStart(2, '0')}-${d?.padStart(2, '0')}`
  }
  if (s.length === 8) {
    // 西元 yyyymmdd
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
  }
  // 民國 yyyymmdd（7 碼：3 碼年 + 2 碼月 + 2 碼日）
  const year = Number(s.slice(0, 3)) + 1911
  return `${year}-${s.slice(3, 5)}-${s.slice(5, 7)}`
}

// 千分位移除 + 轉數字。空字串 / `-` / `--` 等回 NaN（呼叫端負責 skip）。
function toNumber(raw: unknown): number {
  if (typeof raw !== 'string')
    return Number.NaN
  return Number(raw.replace(/,/g, ''))
}

interface RawRow { [key: string]: unknown }

/**
 * FMTQIK（集中市場每日市場成交資訊）→ 加權指數收盤點數。
 * 欄位：`Date`（民國 yyyymmdd）、`TAIEX`（收盤點數、無千分位）。
 */
export function parseTaiexClose(rows: unknown[]): RawPoint[] {
  return (rows as RawRow[]).flatMap((r) => {
    const date = typeof r.Date === 'string' ? r.Date : ''
    const value = toNumber(r.TAIEX)
    return date && Number.isFinite(value) ? [{ date: parseRocDate(date), value }] : []
  })
}

// 傳統 JSON API 共用 shape：`{stat, date, fields, data}`。stat 非 OK 時呼叫端應 skip。
interface LegacyTable {
  fields?: unknown
  data?: unknown
}

// 從 fields/data 取某 row（以第一欄名稱配對）中某欄（以 fields.indexOf 找）的字串值。
// 找不到 row 或欄位時回 undefined。
function pickLegacyCell(table: LegacyTable, rowLabel: string, colName: string): string | undefined {
  const fields = Array.isArray(table.fields) ? table.fields : []
  const data = Array.isArray(table.data) ? table.data : []
  const col = fields.indexOf(colName)
  if (col < 0)
    return undefined
  const row = data.find(r => Array.isArray(r) && r[0] === rowLabel)
  if (!Array.isArray(row))
    return undefined
  const cell = row[col]
  return typeof cell === 'string' ? cell : undefined
}

function topLevelDate(body: { date?: unknown }): string {
  return typeof body.date === 'string' ? parseRocDate(body.date) : ''
}

// 傳統 JSON API 的四個 parser 共用同一個外殼：stat 守衛 → 取值 → 落單一點。
interface LegacyBody extends LegacyTable {
  stat?: unknown
  date?: unknown
  tables?: unknown
}

/**
 * 跑一次「傳統 JSON API → 單一 RawPoint」。
 *
 * `pick` 只負責取值與換算，回 `undefined` 代表這天沒有可用的值——**安靜跳過、不 warn**。
 * 非交易日與尚未公布都會走到這裡，warn 出來只是噪音；真正該吵的是 stat 非 OK
 * （由本函式統一 warn）與欄序變動（由各 pick 自己 warn，因為只有它知道自己在對哪一欄）。
 */
function parseLegacyPoint(body: unknown, code: string, pick: (b: LegacyBody) => number | undefined): RawPoint[] {
  const b = body as LegacyBody
  if (b?.stat !== 'OK') {
    console.warn(`twse-client: ${code} stat=${String(b?.stat)} — skip`)
    return []
  }
  const value = pick(b)
  if (value === undefined || !Number.isFinite(value))
    return []
  return [{ date: topLevelDate(b), value }]
}

function firstTable(b: LegacyBody): LegacyTable | undefined {
  return Array.isArray(b.tables) ? b.tables[0] as LegacyTable : undefined
}

/**
 * MI_MARGN（信用交易統計、傳統 JSON API）→ 全市場融資餘額（億元）。
 * 取 `tables[0]` 的「融資金額(仟元)」row 的「今日餘額」欄、×1000÷1e8 轉億元（仟元→億元）。
 * date 取頂層 `date`（西元 yyyymmdd）。
 *
 * 注意：官方 notes 載明「今日餘額」為初步數、應以「前日餘額」為準。我們落地今日餘額為當日值、
 * 隔日 refresh 不回頭修正前一日的 upsert，可接受（量級正確、偏差極小）。
 * stat 非 OK 時回空陣列 + warn、由上層 refresh skip。
 */
export function parseMarginBalance(body: unknown): RawPoint[] {
  return parseLegacyPoint(body, 'MI_MARGN', (b) => {
    const table = firstTable(b)
    if (!table)
      return undefined
    const thousands = toNumber(pickLegacyCell(table, '融資金額(仟元)', '今日餘額'))
    // 仟元 → 元（×1000）→ 億元（÷1e8）
    return Number.isFinite(thousands) ? (thousands * 1000) / 1e8 : undefined
  })
}

/**
 * MI_MARGN（信用交易統計、傳統 JSON API）→ 全市場融券餘額（張）。
 * 取 tables[0] 的「融券(交易單位)」row 的「今日餘額」欄（單位張、1 張 = 1000 股）、無換算。
 * date 取頂層 date（西元 yyyymmdd）。與 parseMarginBalance（融資金額）同表姊妹 row、
 * 共用 pickLegacyCell（融券 label 在 r[0]）。
 * stat 非 OK（含非交易日「很抱歉…」）時回空 + warn、由上層 refresh skip。
 */
export function parseMarginShortBalance(body: unknown): RawPoint[] {
  return parseLegacyPoint(body, 'MI_MARGN(融券)', (b) => {
    const table = firstTable(b)
    if (!table)
      return undefined
    // 交易單位 = 張、直接落地（無換算）
    return toNumber(pickLegacyCell(table, '融券(交易單位)', '今日餘額'))
  })
}

/**
 * BFI82U（三大法人買賣金額統計表、傳統 JSON API）→ 三大法人買賣超（億元）。
 * 取 `data` 中「合計」row 的「買賣差額」欄（單位：元）÷1e8 轉億元。
 * date 取頂層 `date`（西元 yyyymmdd）。
 *
 * 重要：TWSE OpenAPI 已下架 BFI82U（404/302）、故改用 legacy host 的官方合計數。
 * stat 非 OK 時回空陣列 + warn、由上層 refresh skip。
 */
export function parseInstitutionalNet(body: unknown): RawPoint[] {
  return parseLegacyPoint(body, 'BFI82U', (b) => {
    // 這張表的 fields/data 直接掛在頂層，沒有 tables 包一層。
    const value = toNumber(pickLegacyCell(b, '合計', '買賣差額'))
    // 元 → 億元
    return Number.isFinite(value) ? value / 1e8 : undefined
  })
}

/**
 * TWT93U（融券借券賣出餘額、傳統 JSON API）→ 全市場借券賣出餘額（億股）。
 * data 每股一列、最後「合計」列（名稱欄 r[1]==='合計'、代號欄 r[0] 為空字串）= 全市場加總。
 * 取合計列 index 12「當日餘額」（借券賣出當日餘額、單位股）÷1e8 轉億股。
 *
 * 取值不用 pickLegacyCell：本表合計 label 在 r[1]（r[0] 為空）、pickLegacyCell 以 r[0] 配對故不適用。
 * 改用位置索引 12 + 斷言 fields[12]==='當日餘額' 防呆（欄序變動 → warn skip、不靜默給錯數）。
 * 空資料日（非交易日/未公布）：stat 為 'OK' 但 data:[]、需另 guard、不能只看 stat。
 * stat 非 OK 時回空 + warn、由上層 refresh skip。
 */
export function parseSblBalance(body: unknown): RawPoint[] {
  return parseLegacyPoint(body, 'TWT93U', (b) => {
    const data = Array.isArray(b.data) ? b.data : []
    if (data.length === 0)
      return undefined // 空資料日（非交易日/未公布）、正常情況、不 warn
    const fields = Array.isArray(b.fields) ? b.fields : []
    if (fields[12] !== '當日餘額') {
      console.warn(`twse-client: TWT93U fields[12]=${String(fields[12])} 非「當日餘額」— skip`)
      return undefined
    }
    const total = data.find(r => Array.isArray(r) && r[1] === '合計')
    if (!Array.isArray(total))
      return undefined
    // 股 → 億股（÷1e8）
    const shares = toNumber(total[12])
    return Number.isFinite(shares) ? shares / 1e8 : undefined
  })
}

// seriesId → parser 對應表（以 seriesId 派 parser、不靠 URL 字串判斷、避免 endpoint 變動時誤判）。
const TWSE_PARSERS: Record<string, (body: unknown) => RawPoint[]> = {
  'taiex-close': (body) => {
    // FMTQIK（OpenAPI）回物件陣列；非 array 時 warn + 回空（與 legacy parser 的 stat 警告對稱）。
    if (!Array.isArray(body)) {
      console.warn(`twse-client: FMTQIK expected array body, got ${typeof body} — skip`)
      return []
    }
    return parseTaiexClose(body)
  },
  'taiex-institutional-net': parseInstitutionalNet,
  'taiex-margin-balance': parseMarginBalance,
  'taiex-sbl-balance': parseSblBalance,
  'taiex-margin-short-balance': parseMarginShortBalance,
}

/**
 * 依 SeriesSpec 拉單一 TWSE 序列、回 RawPoint[]。
 * fetch（`fetchTwseDataset(spec.sourceCode)`）後依 seriesId 派對應 parser。
 * 無對應 parser 時 throw（caller 將其計入 failures）。
 */
export async function fetchTwseSeries(spec: SeriesSpec): Promise<RawPoint[]> {
  const parser = TWSE_PARSERS[spec.seriesId]
  if (!parser)
    throw new Error(`twse-client: no parser for ${spec.seriesId}`)
  const body = await fetchTwseDataset(spec.sourceCode)
  return parser(body)
}
