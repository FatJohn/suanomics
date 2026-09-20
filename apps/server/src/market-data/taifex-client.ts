import type { SeriesSpec } from './series-config.js'
import type { RawPoint } from './transform.js'
import { Buffer } from 'node:buffer'
import { fetchSource } from './fetch-source.js'

const TAIFEX_URL = 'https://www.taifex.com.tw/cht/3/futContractsDateDown'
const MS_PER_DAY = 86_400_000
const QUERY_WINDOW_DAYS = 14

// 用標頭名稱定位欄位（非寫死序號、防 TAIFEX 調欄序 silent break）。
const COL_DATE = '日期'
const COL_PRODUCT = '商品名稱'
const COL_IDENTITY = '身份別'
const COL_NET_OI = '多空未平倉口數淨額'
const COL_LONG_OI = '多方未平倉口數'
const COL_SHORT_OI = '空方未平倉口數'
const TARGET_PRODUCT = '臺股期貨'
// TAIFEX 官方分類「外資及陸資」＝外資+陸資合計、無法拆純外資；displayName 用業界簡稱「外資台指期淨部位」。
const TARGET_IDENTITY = '外資及陸資'

// TAIFEX 日期 YYYY/MM/DD → ISO YYYY-MM-DD
function toIsoDate(raw: string): string {
  return raw.trim().replace(/\//g, '-')
}

// TAIFEX 下載端點對非交易日回 HTML（非 CSV）；成功 CSV body 以「日期,」開頭。
// 篩臺股期貨/外資及陸資、取多空未平倉口數淨額。非 CSV 或欄名缺失 → 回 []（graceful、不 throw）。
export function parseTaifexContracts(csvText: string): RawPoint[] {
  const lines = csvText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0)
  const header = lines[0]
  if (!header || !header.startsWith(COL_DATE))
    return []
  const cols = header.split(',')
  const iDate = cols.indexOf(COL_DATE)
  const iProduct = cols.indexOf(COL_PRODUCT)
  const iIdentity = cols.indexOf(COL_IDENTITY)
  const iNet = cols.indexOf(COL_NET_OI)
  const iLongOi = cols.indexOf(COL_LONG_OI)
  const iShortOi = cols.indexOf(COL_SHORT_OI)
  if (iDate < 0 || iProduct < 0 || iIdentity < 0 || iNet < 0)
    return []
  return lines.slice(1).flatMap((line) => {
    const c = line.split(',')
    if (c[iProduct]?.trim() !== TARGET_PRODUCT || c[iIdentity]?.trim() !== TARGET_IDENTITY)
      return []
    // 盤中（約 16:15 結算揭露前）未平倉尚未揭露、多空未平倉口數會皆為 0；
    // 已結算交易日這兩腿必非 0（台指期永遠有未平倉部位），故此過濾不會誤刪真實資料。
    if (iLongOi >= 0 && iShortOi >= 0) {
      const longOi = Number((c[iLongOi] ?? '').replace(/,/g, ''))
      const shortOi = Number((c[iShortOi] ?? '').replace(/,/g, ''))
      if (longOi === 0 && shortOi === 0)
        return []
    }
    const date = toIsoDate(c[iDate] ?? '')
    const value = Number((c[iNet] ?? '').replace(/,/g, ''))
    return date && Number.isFinite(value) ? [{ date, value }] : []
  })
}

// 查詢窗端點刻意用 UTC 曆日、非台北時區；14 天窗已容忍跨午夜單日邊界滑動、snapshot 只取最新值故無礙。
// 查詢參數日期格式 YYYY/MM/DD
function formatSlashDate(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}/${m}/${day}`
}

/**
 * 抓單一 TAIFEX 契約序列（POST + Big5 解碼 + parse）。
 * - sourceCode = commodityId（台指期 TXF）
 * - 查近 QUERY_WINDOW_DAYS 天窗（穩健涵蓋長假、回窗內所有交易日；snapshot 取最新+前值算 delta）
 * - MS950/Big5 → Node 內建 TextDecoder('big5')（零依賴、實測正確）
 * - 逾時與非 200 的轉譯走共用的 `fetchSource`
 * - 非 200 throw（caller 計入 failures）；非交易日回 HTML 由 parseTaifexContracts 判成 []
 */
export async function fetchTaifexSeries(spec: SeriesSpec, now: Date = new Date(), timeoutMs = 15_000): Promise<RawPoint[]> {
  const end = formatSlashDate(now)
  const start = formatSlashDate(new Date(now.getTime() - QUERY_WINDOW_DAYS * MS_PER_DAY))
  const body = `queryStartDate=${start}&queryEndDate=${end}&commodityId=${encodeURIComponent(spec.sourceCode)}`
  const text = await fetchSource(TAIFEX_URL, {
    label: `taifex-client: ${spec.sourceCode}`,
    timeoutMs,
    init: {
      method: 'POST',
      headers: { 'User-Agent': 'Mozilla/5.0', 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    },
    decode: async res => new TextDecoder('big5').decode(Buffer.from(await res.arrayBuffer())),
  })
  return parseTaifexContracts(text)
}
