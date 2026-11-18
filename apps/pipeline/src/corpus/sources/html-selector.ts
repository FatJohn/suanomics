import type { FetchedEntry } from './rss.js'
import * as cheerio from 'cheerio'
import { BODY_FETCH_TIMEOUT_MS, createBodyFetchGuard, readCapped } from './_body-fetch.js'

export interface HtmlSelectorConfig {
  listingUrl: string
  itemSelector: string
  titleSelector: string
  linkSelector: string
  dateSelector: string
  /**
   * 文章頁裡正文容器的 selector。
   *
   * 列表頁只給得出標題與網址，所以**沒有這一項的來源抓回來的每一篇都是
   * `excerpt: null`**——`hasBodyBeyondTitle` 回 false、不 enrich、`entities` 與
   * `topic_tags` 留空，而 retriever 的兩條路徑都是 jsonb containment，空陣列永不命中。
   * 也就是那些文章寫進 DB 之後在檢索裡是不可達的（`fsc-news` 修好 selector、
   * 真的抓到 15 篇，但 15 篇全部檢索不到，而 SLO 只數列數、顯示健康）。
   *
   * `null` 是**明示「這個來源沒有可抓的正文頁」**，與「忘了設」在型別上分得開——
   * seed schema 那邊要求每個 html-selector 來源都得寫出這一格。
   */
  bodySelector?: string | null
  headers?: Record<string, string>
  /**
   * ★ 目前**兩條路徑都沒有真的使用它**（列表與正文都以 UTF-8 解碼）。現有的兩個
   * html-selector 來源都是 UTF-8，所以這是一格從一開始就沒接線的設定。真的要加一個
   * Big5 來源時，要同時接 `fetchHtmlText` 的解碼與 seed schema，不要只改一邊。
   */
  encoding?: string
  timeoutMs?: number
}

const USER_AGENT = 'suanomics/0.1 (cascade corpus)'

/**
 * 單頁 HTML 的大小上限。沒有上限的 `res.text()` 會讓整個 server 行程被 V8 的
 * heap limit 殺掉（`FATAL ERROR: Ineffective mark-compacts`、exit 134，catch 不到），
 * 而 corpus handler 與其他七個 kind、以及 HTTP server 全跑在同一個行程裡。
 * 實測 fsc.gov.tw 列表頁 243KB、文章頁 125KB，5MB 有一個數量級以上的餘裕。
 */
const MAX_HTML_BYTES = 5 * 1024 * 1024

function parseDate(s: string | null): Date | null {
  if (!s)
    return null
  const cleaned = s.trim().replace(/\s+/g, ' ')
  const d = new Date(cleaned)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * 抓一頁 HTML。失敗一律拋——列表頁的呼叫端要讓整個來源標成 fetchFailed，
 * 正文的呼叫端則自己 catch 成 null。
 *
 * `requireHtml` 只有正文頁會開：錯誤頁常常是 HTTP 200 的 HTML，但把 PDF 或大型二進位
 * 整包吞進 cheerio 一樣是白花記憶體。列表頁刻意不檢查——那條路已經在線上跑，加一道
 * 沒量過的門檻只會讓現有來源有機會靜默掉。
 */
async function fetchHtmlText(
  url: string,
  timeoutMs: number,
  headers: Record<string, string> | undefined,
  requireHtml = false,
): Promise<string> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': USER_AGENT, ...headers } })
    if (!res.ok)
      throw new Error(`fetch ${url} status=${res.status}`)
    if (requireHtml && !(res.headers.get('content-type') ?? '').includes('html'))
      throw new Error(`fetch ${url} content-type is not html`)
    const buf = await readCapped(res, MAX_HTML_BYTES)
    if (!buf)
      throw new Error(`fetch ${url} body unreadable or too large (> ${MAX_HTML_BYTES} bytes)`)
    return new TextDecoder('utf-8').decode(buf)
  }
  finally {
    clearTimeout(t)
  }
}

/** 命中 0 個元素、或裡面只剩空白，都回 null——版面還在而內容搬走了，跟沒有正文是同一件事。 */
function extractBody(doc: string, bodySelector: string): string | null {
  const $ = cheerio.load(doc)
  const node = $(bodySelector).first()
  if (node.length === 0)
    return null
  // script/style 的內容 cheerio 的 .text() 會照收，不剝掉的話 CSS 與 JS 會被當成正文
  // 送去 enrich。
  node.find('script, style, noscript').remove()
  const text = node.text()
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n[ \n]*\n/g, '\n')
    .trim()
  return text === '' ? null : text
}

async function fetchArticleBody(url: string, bodySelector: string, headers: Record<string, string> | undefined): Promise<string | null> {
  try {
    return extractBody(await fetchHtmlText(url, BODY_FETCH_TIMEOUT_MS, headers, true), bodySelector)
  }
  catch (err) {
    // 不留訊息的話，站台改版或開始節流時整批文章會安靜地變成「有列但沒內容」，
    // 而 SLO 只數列數、看起來完全健康——這正是曾經發生過的形狀。
    console.warn(`[corpus] html-selector 正文抓取失敗 url=${url}:`, (err as Error).message)
    return null
  }
}

export async function fetchHtmlSelector(config: HtmlSelectorConfig): Promise<FetchedEntry[]> {
  const body = await fetchHtmlText(config.listingUrl, config.timeoutMs ?? 15000, config.headers)

  const $ = cheerio.load(body)
  const entries: FetchedEntry[] = []
  const bodySelector = config.bodySelector
  // 本輪共用的連續失敗計數（所有 entry 的 fetchBody 閉包共享）。見 createBodyFetchGuard。
  const guard = createBodyFetchGuard(`html-selector ${config.listingUrl}`)
  $(config.itemSelector).each((_i, el) => {
    const $el = $(el)
    const title = $el.find(config.titleSelector).first().text().trim()
    const link = $el.find(config.linkSelector).first().attr('href')
    const dateStr = $el.find(config.dateSelector).first().text().trim()
    if (!title || !link)
      return
    let absoluteUrl: string
    try {
      absoluteUrl = new URL(link, config.listingUrl).toString()
    }
    catch {
      return
    }
    entries.push({
      externalId: null,
      url: absoluteUrl,
      title,
      publishedAt: parseDate(dateStr),
      // 列表頁沒有摘要欄位。正文要另外一次請求，而且刻意做成 lazy——corpus-worker 會先用
      // url_hash 去重，已經抓過的文章不該為了拿正文再打一次外部服務（見 FetchedEntry.fetchBody）。
      excerpt: null,
      ...(bodySelector
        ? { fetchBody: () => guard.run(() => fetchArticleBody(absoluteUrl, bodySelector, config.headers)) }
        : {}),
    })
  })
  return entries
}
