import type { EconEvent } from './calendar.js'
import type { WatchlistEntry } from './company-watchlist.js'
import * as cheerio from 'cheerio'
import { CALENDAR_HORIZON_DAYS } from './calendar.js'
import { COMPANY_WATCHLIST } from './company-watchlist.js'
import { parseRocDate } from './twse-client.js'

const MOPS_ENDPOINT = 'https://mopsov.twse.com.tw/mops/web/ajax_t100sb02_1'
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

interface ConferenceDeps {
  fetchHtml?: (rocYear: number, month: number) => Promise<string>
  watchlist?: WatchlistEntry[]
  now?: Date
}

// 預設抓取：POST form、回 HTML 字串。UTF-8、免 cookie/UA。
async function defaultFetchHtml(rocYear: number, month: number, timeoutMs = 15_000): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const body = new URLSearchParams({
      step: '1',
      firstin: 'true',
      off: '1',
      TYPEK: 'sii',
      year: String(rocYear),
      month: String(month).padStart(2, '0'),
    })
    const res = await fetch(MOPS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: controller.signal,
    })
    if (!res.ok)
      throw new Error(`investor-conference: MOPS HTTP ${res.status}`)
    return await res.text()
  }
  catch (err) {
    if (err instanceof Error && err.name === 'AbortError')
      throw new Error(`investor-conference: MOPS timeout after ${timeoutMs}ms`)
    throw err
  }
  finally {
    clearTimeout(timer)
  }
}

// 行事曆視窗 [now, now+CALENDAR_HORIZON_DAYS] 涵蓋的 (民國年, 月) 集合（1 或 2 個、去重）。
// ★ 天數必須跟 calendar.ts 的視窗同一份常數：這裡決定「去 MOPS 抓哪幾個民國月」，
//   窄於行事曆視窗的話，窗尾那幾天的法說會會在抓取階段就靜默漏掉——而下游看到的
//   只是「那幾天沒有法說會」，跟真的沒有長得一樣。
function rocMonthsInWindow(now: Date): Array<[number, number]> {
  const end = new Date(now.getTime() + CALENDAR_HORIZON_DAYS * 24 * 60 * 60 * 1000)
  const key = (d: Date): [number, number] => [d.getUTCFullYear() - 1911, d.getUTCMonth() + 1]
  const a = key(now)
  const b = key(end)
  return (a[0] === b[0] && a[1] === b[1]) ? [a] : [a, b]
}

// 解析 MOPS 法說會 HTML table：data-type='body' 列、前 3 td = 代號/名稱/日期。
function parseConferenceRows(html: string): Array<{ code: string, name: string, rocDate: string }> {
  const $ = cheerio.load(html)
  const rows: Array<{ code: string, name: string, rocDate: string }> = []
  $('tr[data-type=\'body\']').each((_, tr) => {
    const tds = $(tr).find('td')
    const code = $(tds[0]).text().trim()
    const name = $(tds[1]).text().trim()
    const rocDate = $(tds[2]).text().trim()
    if (code && rocDate)
      rows.push({ code, name, rocDate })
  })
  return rows
}

/**
 * 抓 MOPS 法人說明會一覽（上市 sii）、過濾權值股名單、map 成 category='investor-conference'
 * 的 EconEvent[]。7 天窗跨月時抓當月 + 次月。fetchHtml 注入以利測試。
 */
export async function fetchInvestorConferenceEvents(deps: ConferenceDeps = {}): Promise<EconEvent[]> {
  const fetchHtml = deps.fetchHtml ?? ((y, m) => defaultFetchHtml(y, m))
  const codes = new Set((deps.watchlist ?? COMPANY_WATCHLIST).map(w => w.code))
  const now = deps.now ?? new Date()

  const months = rocMonthsInWindow(now)
  const htmls = await Promise.all(months.map(([y, m]) => fetchHtml(y, m)))

  return htmls.flatMap(parseConferenceRows).flatMap((row) => {
    if (!codes.has(row.code))
      return []
    const date = parseRocDate(row.rocDate)
    if (!ISO_DATE.test(date))
      return []
    return [{
      date,
      title: `${row.name}（${row.code}）法說會`,
      region: 'TW' as const,
      importance: 'medium' as const,
      category: 'investor-conference' as const,
      companyCode: row.code,
    }]
  })
}
