import { XMLParser } from 'fast-xml-parser'
import { extractText, getDocumentProxy } from 'unpdf'
import { BODY_FETCH_TIMEOUT_MS, createBodyFetchGuard, readCapped } from './_body-fetch.js'

export interface FetchedEntry {
  externalId: string | null
  url: string
  title: string
  publishedAt: Date | null
  excerpt: string | null
  /**
   * 延後抓取的正文。給「列表只有標題與網址、正文要另外一次請求」的來源用
   * （TWSE 公告的正文在另一個端點指到的 PDF 裡）。
   *
   * ★ 做成 lazy 而不是在 parser 裡直接抓：corpus-worker 會先用 url_hash 去重，已經抓過的
   *   文章不該為了拿正文再打一次外部服務。一個 538 筆的來源，第二輪 refresh 只會對真正的
   *   新文章呼叫這個函式。
   *
   * 回 null＝這次拿不到正文（網路失敗、格式不符、沒有可解析的內容）。呼叫端要把它當成
   * 「沒有 excerpt」走既有的「body 沒超出標題就不 enrich」那條路，不要往上拋。
   */
  fetchBody?: () => Promise<string | null>
}

export interface RssFetchConfig {
  feedUrl: string
  format?: 'rss' | 'atom' | 'cnyes-json' | 'twse-news-json'
  encoding?: string
  timeoutMs?: number
}

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', parseTagValue: false })

function strOrNull(v: unknown): string | null {
  if (typeof v === 'string')
    return v
  if (typeof v === 'number')
    return String(v)
  if (v && typeof v === 'object' && '#text' in v)
    return strOrNull((v as { '#text'?: unknown })['#text'])
  return null
}

function parseDate(s: string | null): Date | null {
  if (!s)
    return null
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

async function fetchText(url: string, timeoutMs: number): Promise<string> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'suanomics/0.1 (cascade corpus)' } })
    if (!res.ok)
      throw new Error(`fetch ${url} status=${res.status}`)
    return await res.text()
  }
  finally {
    clearTimeout(t)
  }
}

// TWSE OpenAPI 的日期是民國 yyyymmdd 的**日期字串、不帶時間**（例如 '1150821'）。
// 轉成**台北零點**而不是 UTC 零點：TWSE 公告的日期本來就是台北日期。
// ★ 不要寫成「否則下游的相對日期標籤會差一天」——那是假的因果：`external_articles.published_at`
//   目前**沒有任何讀者**（retriever select 的是 fetchedAt，relativeDayLabel 吃的是 news_items）。
//   選台北零點的理由只是「這個值在將來被啟用時語意要正確」。
//
// 沒有共用 market-data/twse-client.ts 的 parseRocDate，理由有二：一是不想讓 corpus 反向
// 依賴 market-data；二是那支不驗格式（傳空字串會算出 'NaN-undefined-undefined'），而這裡
// 拿到的是外部 API 的原始欄位，格式壞掉要能安全地回 null。
function parseTwseRocDate(raw: string | null): Date | null {
  if (!raw || !/^\d{7}$/.test(raw))
    return null
  const year = Number(raw.slice(0, 3)) + 1911
  const d = new Date(`${year}-${raw.slice(3, 5)}-${raw.slice(5, 7)}T00:00:00+08:00`)
  return Number.isNaN(d.getTime()) ? null : d
}

const TWSE_ORIGIN = 'https://www.twse.com.tw'

/**
 * PDF 大小上限。**沒有上限的 `res.arrayBuffer()` 會殺掉整個 server 行程**：驗收時實測
 * 餵一份 300MB 的回應，V8 直接 `FATAL ERROR: Ineffective mark-compacts near heap limit`
 * 並 exit 134——那是 catch 不到的，而 corpus handler 與其他七個 kind、以及 HTTP server 全跑在同一個行程裡。
 * 實測 TWSE 公告 PDF 平均約 300KB，20MB 有兩個數量級的餘裕。
 */
const MAX_PDF_BYTES = 20 * 1024 * 1024

/**
 * 抓一則 TWSE 公告的正文。
 *
 * 為什麼要兩步：`news/newsList` 只給標題與網址，而那個網址是 SPA 殼（內容靠 JS 讀
 * location.search 再打 newsDetail）。正文一律在 PDF 裡——2026-08-22 抽樣 6 則，
 * newsDetail 回應的 `text` 與 `html` 欄位**全部是空字串**，只有 `pdf` 有值。
 *
 * PDF 路徑要接在 `/staticFiles` 底下，組法出自 `twse.com.tw/res/js/web-news.js` 的
 * `"/staticFiles" + d.pdf`。
 *
 * ★ **路徑組錯不會得到 404**：直接用 d.pdf 會 307 轉到一頁 HTTP 200 的 HTML 錯誤頁
 *   （2026-08-22 實測 747 bytes）。也就是 `res.ok` 對路徑錯誤完全無效，所以下面另外檢查
 *   content-type 與 `%PDF` magic bytes——少了那兩道，錯誤頁會被送進 unpdf 當 PDF 解。
 *
 * ★ 全程失敗都回 null 而不是拋：一則公告的 PDF 掛掉不該讓整輪 corpus refresh 失敗。
 *   呼叫端把 null 當成「沒有 body」，走既有的「body 沒超出標題就不 enrich」那條路。
 */
async function fetchTwseAnnouncementBody(newsId: string, timeoutMs: number): Promise<string | null> {
  try {
    const detailRaw = await fetchText(`${TWSE_ORIGIN}/rwd/zh/news/newsDetail?id=${encodeURIComponent(newsId)}`, timeoutMs)
    const detail = JSON.parse(detailRaw) as { tables?: Array<{ fields?: unknown, data?: unknown }> }
    const table = detail.tables?.[0]
    const fields = Array.isArray(table?.fields) ? table.fields.map(String) : []
    const data = Array.isArray(table?.data) ? table.data.map(String) : []
    const pdfIdx = fields.indexOf('pdf')
    const pdfPath = pdfIdx >= 0 ? data[pdfIdx] : undefined
    if (!pdfPath)
      return null

    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const res = await fetch(`${TWSE_ORIGIN}/staticFiles${pdfPath}`, { signal: ctrl.signal })
      if (!res.ok)
        return null
      // soft-404 的第一道：錯誤頁的 content-type 是 text/html。
      if (!(res.headers.get('content-type') ?? '').includes('pdf'))
        return null
      const buf = await readCapped(res, MAX_PDF_BYTES)
      if (!buf)
        return null
      // 第二道：%PDF magic bytes。content-type 可以被錯設，檔案開頭不會。
      if (buf[0] !== 0x25 || buf[1] !== 0x50 || buf[2] !== 0x44 || buf[3] !== 0x46)
        return null
      const pdf = await getDocumentProxy(buf)
      const { text } = await extractText(pdf, { mergePages: true })
      const merged = (Array.isArray(text) ? text.join('\n') : text).trim()
      // 抽不出任何字＝這份 PDF 是掃描影像，不是文字型。回 null 走不 enrich 那條路，
      // 不要讓一份空字串進 corpus 假裝有內容。
      return merged === '' ? null : merged
    }
    finally {
      clearTimeout(t)
    }
  }
  catch (err) {
    // 這裡曾經是 bare catch。不留訊息的話，TWSE 換了 PDF 路徑或開始節流時整批文章會
    // 安靜地變成「有列但沒內容」，而 SLO 只數列數、看起來完全健康。
    console.warn(`[corpus] twse announcement body failed newsId=${newsId}:`, (err as Error).message)
    return null
  }
}

function parseTwseNewsJson(body: string, _timeoutMs: number): FetchedEntry[] {
  const parsed: unknown = JSON.parse(body)
  if (!Array.isArray(parsed))
    return []
  // 本輪共用的連續失敗計數（所有 entry 的 fetchBody 閉包共享）。見 createBodyFetchGuard。
  const guard = createBodyFetchGuard('twse 公告')
  return (parsed as Record<string, unknown>[]).map((r): FetchedEntry => {
    const url = strOrNull(r.Url) ?? ''
    // Url 的 query 段就是 TWSE 給該則公告的 id，拿它當 externalId 比整條網址穩定，
    // 也是 newsDetail 要的那個 id。
    const newsId = url.split('?')[1] ?? null
    return {
      externalId: newsId,
      url,
      title: strOrNull(r.Title) ?? '',
      publishedAt: parseTwseRocDate(strOrNull(r.Date)),
      // 列表端點沒有摘要欄位，正文要另外抓（見 fetchTwseAnnouncementBody）。這裡留 null、
      // 不用標題填充——那正是代理來源「摘要是憑標題編的」那個問題的來源。
      excerpt: null,
      fetchBody: () => guard.run(async () => (newsId ? fetchTwseAnnouncementBody(newsId, BODY_FETCH_TIMEOUT_MS) : null)),
    }
  }).filter(e => e.url && e.title)
}

function parseCnyesJson(body: string): FetchedEntry[] {
  const data = JSON.parse(body) as { items?: { data?: Array<Record<string, unknown>> } }
  const items = data.items?.data ?? []
  return items.map((i): FetchedEntry => ({
    externalId: strOrNull(i.newsId),
    url: strOrNull(i.url) ?? `https://news.cnyes.com/news/id/${strOrNull(i.newsId) ?? ''}`,
    title: strOrNull(i.title) ?? '',
    publishedAt: typeof i.publishAt === 'number' ? new Date((i.publishAt as number) * 1000) : null,
    excerpt: strOrNull(i.summary),
  })).filter(e => e.url && e.title)
}

function parseXmlFeed(body: string): FetchedEntry[] {
  const xml = parser.parse(body) as Record<string, unknown>
  const rssChannel = (xml.rss as { channel?: Record<string, unknown> } | undefined)?.channel
  const atomFeed = xml.feed as Record<string, unknown> | undefined
  const channel = rssChannel ?? atomFeed ?? null
  if (!channel)
    return []
  const rawItems = (channel as { item?: unknown, entry?: unknown }).item ?? (channel as { entry?: unknown }).entry ?? []
  const items: Record<string, unknown>[] = Array.isArray(rawItems) ? (rawItems as Record<string, unknown>[]) : [rawItems as Record<string, unknown>]

  return items.map((it): FetchedEntry => ({
    externalId: strOrNull(it.guid) ?? strOrNull(it.id),
    url: strOrNull(it.link) ?? strOrNull((it.link as { href?: unknown } | undefined)?.href) ?? '',
    title: strOrNull(it.title) ?? '',
    publishedAt: parseDate(strOrNull(it.pubDate) ?? strOrNull(it.published) ?? strOrNull(it.updated)),
    excerpt: strOrNull(it.description) ?? strOrNull(it.summary),
  })).filter(e => e.url && e.title)
}

export async function fetchRssSource(config: RssFetchConfig): Promise<FetchedEntry[]> {
  const timeout = config.timeoutMs ?? 15000
  const body = await fetchText(config.feedUrl, timeout)
  if (config.format === 'cnyes-json')
    return parseCnyesJson(body)
  if (config.format === 'twse-news-json')
    return parseTwseNewsJson(body, timeout)
  return parseXmlFeed(body)
}
