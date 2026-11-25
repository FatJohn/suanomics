import type { EconEvent } from './calendar.js'
import type { WatchlistEntry } from './company-watchlist.js'
import { COMPANY_WATCHLIST } from './company-watchlist.js'
import { fetchTwseDataset, parseRocDate } from './twse-client.js'

const TWT48U_ENDPOINT = '/v1/exchangeReport/TWT48U_ALL'
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

interface Twt48uRow { Date?: unknown, Code?: unknown, Name?: unknown, Exdividend?: unknown }

interface ExDividendDeps {
  fetchRows?: () => Promise<unknown>
  watchlist?: WatchlistEntry[]
}

// 除權息類型 label：息→除息、權→除權、權息→除權息；其餘原樣（防未知值）。
function exLabel(raw: string): string {
  if (raw === '息')
    return '除息'
  if (raw === '權')
    return '除權'
  if (raw === '權息')
    return '除權息'
  return raw
}

/**
 * 抓 TWSE 除權除息預告（TWT48U_ALL、OpenAPI JSON array）、過濾權值股名單、
 * map 成 category='ex-dividend' 的 EconEvent[]。不做 7 天窗過濾（交 buildCalendarBlock）。
 * fetchRows 注入以利測試；預設用既有 fetchTwseDataset（GET）。
 */
export async function fetchExDividendEvents(deps: ExDividendDeps = {}): Promise<EconEvent[]> {
  const fetchRows = deps.fetchRows ?? (() => fetchTwseDataset(TWT48U_ENDPOINT))
  const codes = new Set((deps.watchlist ?? COMPANY_WATCHLIST).map(w => w.code))

  const body = await fetchRows()
  if (!Array.isArray(body))
    return []

  return (body as Twt48uRow[]).flatMap((r) => {
    const code = typeof r.Code === 'string' ? r.Code : ''
    const name = typeof r.Name === 'string' ? r.Name : ''
    const rawDate = typeof r.Date === 'string' ? r.Date : ''
    const ex = typeof r.Exdividend === 'string' ? r.Exdividend : ''
    if (!codes.has(code) || !rawDate)
      return []
    const date = parseRocDate(rawDate)
    if (!ISO_DATE.test(date))
      return []
    return [{
      date,
      title: `${name}（${code}）${exLabel(ex)}`,
      region: 'TW' as const,
      importance: 'medium' as const,
      category: 'ex-dividend' as const,
      companyCode: code,
    }]
  })
}
