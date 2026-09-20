import { Buffer } from 'node:buffer'
import { load } from 'cheerio'
import { Agent } from 'undici'

const MIN_LEN = 30

/**
 * undici（Node 內建 fetch 的底層實作）對回應標頭的預設上限是 16 KB
 * （`maxHeaderSize`），超過就整次呼叫直接丟 `Headers Overflow Error`——連
 * `res.ok`／`res.status` 都拿不到，是 fetch 本身失敗，不是 HTTP 語意上的錯誤。
 *
 * `hk.finance.yahoo.com` 是幾個關鍵字型 Google News 代理常落到的再供稿站，它的
 * cookie／CSP 標頭疊起來會超過這個上限。2026-09-08 實測：對
 * `https://hk.finance.yahoo.com/` 用預設 fetch → `Headers Overflow Error`；
 * 帶這個 64 KB 的 `Agent` 當 dispatcher → `200`、body 557 KB、24 個標頭。
 *
 * 建成**全域 fetch 的 dispatcher**（傳進每次呼叫的 `fetch(url, { dispatcher })`），
 * 而不是改用 `import { fetch } from 'undici'`：後者會讓既有測試的
 * `vi.stubGlobal('fetch', ...)` 全部失效。★ 這條放寬是 **scoped**、不是全域改了
 * Node 的預設值——同一支診斷程序裡，不帶這個 dispatcher 的另一次 fetch 呼叫仍然
 * `Headers Overflow Error`（實測過，不是推論）。
 *
 * module 層建一次、不是每次呼叫都 `new Agent(...)`：每次新建等於開一個新的
 * connection pool，會丟掉 keep-alive、對同一個 host 反覆握手。
 *
 * export 出來是為了讓測試斷言「傳進 fetch 的 dispatcher 就是這一個」而不必去讀
 * undici 內部才拿得到的設定值。
 */
export const SCRAPE_DISPATCHER = new Agent({ maxHeaderSize: 64 * 1024 })

/**
 * 這個 repo 的 tsconfig 沒吃到 undici-types 對全域 `RequestInit` 的 `dispatcher`
 * 擴充（`@types/node` 的 `web-globals/fetch.d.ts` 是否併入 undici 的版本取決於
 * `lib` 設定，這裡驗過確實併不進來），實跑時 Node 的全域 `fetch` 完全接受
 * `dispatcher`——這是型別落後於 runtime，不是把整個 `init` 物件斷言掉。
 */
type FetchInitWithDispatcher = RequestInit & { dispatcher?: Agent }

/**
 * **日報那套**（`news_sources` → `news_items`）對外抓頁面時用的 UA。Cascade 的 corpus
 * 路徑另有自己的 UA（`corpus/sources/rss.ts` 與 `html-selector.ts` 的
 * `suanomics/0.1 (cascade corpus)`），兩套沒有共用、這裡不管那邊。
 *
 * 抽成常數不是為了整潔：`ctee` 那類站台的 robots.txt 擋的是**具名的 UA 清單**
 * （`ClaudeBot`／`GPTBot`／`anthropic-ai` 等），所以「我們自稱是誰」是一個會被別人
 * 據以判斷的事實。日報這條路徑接下來會多一個抓 Google News 中介頁的呼叫點，散成兩份
 * 字串就會出現「其中一條改了名、另一條沒改」，而那件事在 log 上看不出來。
 */
export const NEWS_FETCH_USER_AGENT = 'Mozilla/5.0 suanomics/1.0 (news analyzer)'

/** 從 `Content-Type` 或前 2 KB HTML 裡的 `<meta>` 找 `charset=` 的值。 */
const CHARSET_PATTERN = /charset\s*=\s*["']?([\w-]+)/i

/**
 * sniff `<meta>` 時只看前幾 KB——真正的 charset 宣告一律在 `<head>` 開頭附近，
 * 掃整份文件既浪費、又可能在 `<body>` 內容裡誤撞到跟編碼無關的 `charset=` 字樣。
 */
const META_SNIFF_WINDOW = 2048

/**
 * MoneyDJ 這類站台的 `Content-Type` 常常不帶 `charset`（實測
 * `curl -sI https://www.moneydj.com/` 回 `content-type: text/html`，完全沒有
 * `charset=` 片段），而 `res.text()` 一律當 UTF-8 解——Big5 字元被硬解成 UTF-8
 * 會產生 U+FFFD，原樣寫進 `news_items.content_text` 且標成 `content_source='scrape'`。
 *
 * 順序不是隨意排列：**① `Content-Type` 的 `charset=` 優先**——同網域
 * `moneydj.com/kmdj/news/newsviewer.aspx` 那個路徑的 `Content-Type` **有**
 * `charset=utf-8`、meta 卻沒寫，兩個真實頁面剛好互補，證明兩種訊號都要顧到、
 * 不能只認其中一種。**② header 沒有才 sniff meta**（`<meta charset="X">` 或
 * `<meta http-equiv="Content-Type" content="...;charset=X">`，同一個正規表達式
 * 就能認出兩種寫法）。**③ 都沒有才回 `'utf-8'`**（沿用改動前的行為，不倒退）。
 *
 * sniff 用 latin1 解前 2 KB，不是巧合——latin1 是唯一「每個 byte 對應一個
 * code point、絕不拋例外」的解碼方式，拿它去找 ASCII 範圍內的 `charset=` 字樣
 * 剛好夠用，不需要先知道真正的編碼才能找出編碼宣告本身（雞生蛋問題）。
 */
export function detectCharset(contentType: string | null, bytes: Uint8Array): string {
  const headerMatch = contentType?.match(CHARSET_PATTERN)
  if (headerMatch?.[1])
    return headerMatch[1].toLowerCase()

  const head = Buffer.from(bytes.subarray(0, META_SNIFF_WINDOW)).toString('latin1')
  const metaMatch = head.match(CHARSET_PATTERN)
  if (metaMatch?.[1])
    return metaMatch[1].toLowerCase()

  return 'utf-8'
}

/**
 * `new TextDecoder(label)` 對認不得的 label（站台 meta 寫錯、或是我們的正規表達式
 * 誤判抓到一段不是編碼名稱的雜訊）會丟 `RangeError`。這是**解碼問題，不是網路
 * 問題**——必須在這裡接住、退回 utf-8，不能讓它穿出去給 `scrapeArticle` 外層的
 * fetch catch 誤標成 `network_error`（那會讓下一個人往「連線失敗」查，查不到
 * 任何東西，因為根本沒有連線失敗）。
 */
function decodeBytes(bytes: Uint8Array, charset: string): string {
  try {
    return new TextDecoder(charset).decode(bytes)
  }
  catch (err) {
    if (err instanceof RangeError)
      return new TextDecoder('utf-8').decode(bytes)
    throw err
  }
}

export function extractArticleText(html: string): string | null {
  const $ = load(html)
  $('script, style, noscript').remove()
  const paragraphs = $('article p, main p, body p')
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(t => t.length > 0)
  if (paragraphs.length === 0)
    return null
  const text = paragraphs.join('\n').trim()
  return text.length >= MIN_LEN ? text : null
}

/**
 * 抓取失敗的分類。刻意不含「沒有正文」——那不是失敗，是合法的空結果，走 `ok: true`。
 *
 * `timeout` 只給自己那顆計時器觸發的 AbortError。把 DNS／連線失敗也標成逾時，會讓
 * 下一個人往「對方太慢」的方向查，而真因是連都沒連上（判準同
 * `market-data/fetch-source.ts`）。
 */
export type ScrapeFailureReason = 'http_error' | 'timeout' | 'network_error' | 'parse_error'

/**
 * `ok` 回答的是「這次呼叫成功了嗎」，`text` 回答的是「有沒有抽得出來的正文」——
 * **兩個獨立的問題**。
 *
 * 改之前這個函式回 `string | null`，非 2xx、逾時、DNS 失敗、
 * body 讀壞，加上「正文太短」這個完全合法的情境，五種狀況共用同一個 `null`——
 * 呼叫端連「剛剛打過一次網路、而且失敗了」都不知道。
 */
export type ScrapeResult
  = | { ok: true, text: string | null }
    | { ok: false, reason: ScrapeFailureReason, detail: string }

export interface ScrapeDeps {
  timeoutMs?: number
  /**
   * 抽正文的實作。可注入的唯一理由是**讓 `parse_error` 那條分支測得到**——
   * 這條路徑用真實 HTML 幾乎逼不出來（cheerio 只有在輸入是 null/undefined 或
   * 深到爆 stack 時才拋），而它正是 2026-08-22 驗收抓到的行為倒退所在：
   * 解析拋例外若沒被接住，會穿出這個函式、讓呼叫端把**整個來源**標成失敗。
   * 注入式 deps 是這個 repo 的既有慣例（`fetchImpl ?? fetch`）。
   */
  extract?: (html: string) => string | null
}

export async function scrapeArticle(url: string, deps: ScrapeDeps = {}): Promise<ScrapeResult> {
  const timeoutMs = deps.timeoutMs ?? 10_000
  const extract = deps.extract ?? extractArticleText
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  let html: string
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      headers: { 'user-agent': NEWS_FETCH_USER_AGENT },
      dispatcher: SCRAPE_DISPATCHER,
    } as FetchInitWithDispatcher)
    if (!res.ok)
      return { ok: false, reason: 'http_error', detail: `HTTP ${res.status}` }
    // res.arrayBuffer() 也算在逾時窗內：body 讀到一半卡住同樣是失敗，提早回傳
    // Response 會讓那段變成不設防（同 fetch-source.ts 的理由）。改讀 bytes 而不是
    // res.text()：後者一律當 UTF-8 解，Big5 站（MoneyDJ）會解出 U+FFFD。
    const bytes = new Uint8Array(await res.arrayBuffer())
    const charset = detectCharset(res.headers.get('content-type'), bytes)
    html = decodeBytes(bytes, charset)
  }
  catch (err) {
    // ★ 必須同時看 ctl.signal.aborted：只比對 err.name 的話，任何**別人**丟的
    // AbortError 都會被標成「timeout after <我們的 timeoutMs>ms」——一個憑空編造
    // 的數字。今天這個函式不收外部 signal 所以撞不到，但這是樣板，下一個 client
    // 收了外部 signal 就會踩。
    if (err instanceof Error && err.name === 'AbortError' && ctl.signal.aborted)
      return { ok: false, reason: 'timeout', detail: `timeout after ${timeoutMs}ms` }
    return { ok: false, reason: 'network_error', detail: describeError(err) }
  }
  finally { clearTimeout(timer) }

  try {
    // 抽不出正文不是失敗：這則新聞可能本來就只有標題與圖。呼叫端要分得出這件事
    // 與「網路掛了」，所以它走 ok: true。
    return { ok: true, text: extract(html) }
  }
  catch (err) {
    // 解析拋例外必須被接住。讓它穿出去的話，呼叫端的 pMap 會整批 reject、
    // 把**整個來源**標成失敗——而來源的 RSS 其實是好的，那是 SLO 假告警。
    return { ok: false, reason: 'parse_error', detail: describeError(err) }
  }
}

/**
 * 把 error 攤成一行可讀訊息。**帶上 `cause`**：undici 的網路錯誤一律是
 * `TypeError: fetch failed`，真正的區別（ENOTFOUND vs ECONNREFUSED vs 憑證錯）
 * 只在 cause 裡。少了它，log 上所有連線類失敗長得一模一樣。
 */
function describeError(err: unknown): string {
  if (!(err instanceof Error))
    return String(err)
  const cause = err.cause
  const causeMsg = cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : ''
  return causeMsg ? `${err.message}: ${causeMsg}` : err.message
}
