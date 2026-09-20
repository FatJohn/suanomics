import process from 'node:process'
import {
  buildUpsertRows,
  getActiveSources,
  getExistingExternalIds,
  getNewsItemsByIds,
  insertNewsItems,
  updateScrapedContent,
} from '@suanomics/db/repos/news-repo'
import { isGoogleNewsProxySeed } from '@suanomics/db/seed'
import { dedupByExternalId, fetchRss, parseRssXml } from '../external/rss-fetcher.js'
import { scrapeArticle } from '../external/scraper.js'
import { isBodyFetchDenied } from './body-fetch-policy.js'
import { categorizeAndStore } from './categorize.js'
import { tagAndStore } from './tag.js'

// 逐篇失敗只印這麼多筆，其餘靠彙總行。理由見呼叫處。
const SCRAPE_FAILURE_LOG_SAMPLE = 3

export interface RunNewsRefreshResult {
  sourcesProcessed: number
  sourcesFailed: number
  totalInserted: number
  // scrapeFailed = 這個來源有幾篇文章「抓取本身失敗」（呼叫本身失敗，如 403／timeout）。
  // 刻意**不含**「抓到了但沒有正文」——那是合法結果，算進來會讓這個數字把正常情況記成
  // 故障、量趨勢時整條線都是假的。那一類走 `scrapeEmpty`。
  perSource: {
    slug: string
    inserted: number
    failed: boolean
    scrapeFailed: number
    // - `bodyDenied`：目標 host 在拒抓清單上（`body-fetch-policy.ts` 的
    //   `BODY_FETCH_DENIED_HOSTS`），政策上不抓正文。
    // - `feedSkipped`：整個 feed 是 Google News 代理（`isGoogleNewsProxySeed`）——這批
    //   來源的 `<link>` 是轉址頁，抓那一頁拿不到正文（見下面 `resolveArticleTarget` 的
    //   註解），所以整批連抓都不抓，不是逐篇判定。
    // - `scrapeEmpty`：目標 host 沒被拒抓、對方也回了 2xx，但 `extract` 抽不出正文。
    //   ★ 與 `scrapeFailed` 是不同修法——`scrapeFailed` 對應對方擋（403／timeout），
    //   `scrapeEmpty` 對應我們這邊抽不到：選擇器不合這個站、或頁面本來就只有標題／
    //   正文短於 extractor 的下限（見 `scraper.ts` 的 `extractArticleText`），混在一起
    //   就修不了。2026-09-07 首輪實跑 258 則裡 17 則落在這一格。
    bodyDenied: number
    feedSkipped: number
    scrapeEmpty: number
  }[]
}

/**
 * 一則新聞要抓哪個網址，或為什麼不抓。
 *
 * Google News 代理來源（`isGoogleNewsProxySeed`）在 feed 層就整批跳過了，不會走到
 * 這裡——這批來源的 `<link>` 指向轉址頁，抓那一頁拿不到正文（本機 DB 實測 2026-09-07
 * 這批來源累積 22,271 則、`content_source = 'scrape'` **0 則**），所以整批不抓。
 * 這裡只處理直連來源。直連網址一樣要過拒抓清單：哪天加一個直連的 ctee feed 一樣要擋，
 * 不能只靠代理來源那條路徑檢查。
 */
type ResolvedTarget = { kind: 'scrape', url: string } | { kind: 'denied', url: string }

function resolveArticleTarget(url: string): ResolvedTarget {
  return isBodyFetchDenied(url) ? { kind: 'denied', url } : { kind: 'scrape', url }
}

type PerSourceEntry = RunNewsRefreshResult['perSource'][number]

/** 一個來源這一輪的計數。`PerSourceEntry` 是它的超集，所以計數可以直接累加進那一筆。 */
interface SourceTally {
  scrapeFailed: number
  bodyDenied: number
  feedSkipped: number
  scrapeEmpty: number
}

function newTally(): SourceTally {
  return { scrapeFailed: 0, bodyDenied: 0, feedSkipped: 0, scrapeEmpty: 0 }
}

/** 解析目標網址 → 抓正文 → 有正文才寫入。每一種不寫入的理由各自計數。 */
async function fetchAndStoreBody(item: { id: number, url: string }, slug: string, tally: SourceTally): Promise<void> {
  const target = resolveArticleTarget(item.url)
  if (target.kind === 'denied') {
    tally.bodyDenied += 1
    return
  }

  // scrapeArticle 回的是 ok/reason 契約，所以這裡分得出三件事：
  // 抓到正文、呼叫成功但這篇沒有正文、呼叫本身失敗。以前三者都是 null，
  // 一個 `if (text)` 就把它們全吃掉了——失敗連一行 log 都不會留。
  const scraped = await scrapeArticle(target.url)
  if (!scraped.ok) {
    tally.scrapeFailed += 1
    // 逐篇只印前幾筆：一個整站回 403 的來源
    // 一次 refresh 可以吐數百行。前幾筆足以看出 pattern（同一個 reason、
    // 同一個 host），總數由彙總行給。
    if (tally.scrapeFailed <= SCRAPE_FAILURE_LOG_SAMPLE)
      console.warn(`[runNewsRefresh] ${slug} scrape ${scraped.reason}: ${target.url} (${scraped.detail})`)
    return
  }
  if (scraped.text) {
    await updateScrapedContent(item.id, scraped.text)
    return
  }
  // 呼叫成功、對方也回了 2xx，但 extract 抽不出正文——這跟上面的「呼叫失敗」是不同
  // 修法（extractor 選擇器 vs 對方擋），所以另外數、另外印前綴，好分開 grep。
  tally.scrapeEmpty += 1
  if (tally.scrapeEmpty <= SCRAPE_FAILURE_LOG_SAMPLE)
    console.warn(`[runNewsRefresh] ${slug} scrape empty: ${target.url}`)
}

function defaultConcurrency(): number {
  return Math.max(1, Number.parseInt(process.env.NEWS_FETCH_CONCURRENCY ?? '3', 10) || 3)
}

async function pMap<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  let i = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++
      const item = items[idx]
      if (item === undefined)
        continue
      out[idx] = await fn(item)
    }
  }))
  return out
}

function logTally(slug: string, attempted: number, tally: SourceTally): void {
  // 單篇 scrape 失敗**不**把整個來源標成失敗：來源的 RSS 是好的、新聞也進得來，
  // 標失敗會讓 SLO 誤報這個 feed 死掉。它是另一件事，所以另外數、另外說。
  const omitted = (n: number): string => (n > SCRAPE_FAILURE_LOG_SAMPLE ? `（上面只列前 ${SCRAPE_FAILURE_LOG_SAMPLE} 筆）` : '')
  if (tally.scrapeFailed > 0)
    console.warn(`[runNewsRefresh] ${slug}: ${tally.scrapeFailed}/${attempted} 篇 scrape 失敗${omitted(tally.scrapeFailed)}`)
  if (tally.scrapeEmpty > 0)
    console.warn(`[runNewsRefresh] ${slug}: ${tally.scrapeEmpty}/${attempted} 篇 scrape 成功但沒有正文${omitted(tally.scrapeEmpty)}`)
}

export async function runNewsRefresh(): Promise<RunNewsRefreshResult> {
  const concurrency = defaultConcurrency()
  const sources = await getActiveSources()
  console.warn(`[runNewsRefresh] ${sources.length} active sources (concurrency=${concurrency})`)

  let totalInserted = 0
  let sourcesFailed = 0
  const perSource: RunNewsRefreshResult['perSource'] = []

  for (const src of sources) {
    // 這一輪已經 push 進 perSource 的那一筆（還沒 push 就是 null）。catch 要靠它分辨
    // 「連新聞都還沒插入就失敗」與「插入成功、抓正文途中才失敗」——後者若再 push 一筆，
    // 同一個 slug 在 metadata 上會出現兩列，按 slug 聚合的讀法怎麼算都不對。
    let entry: PerSourceEntry | null = null
    try {
      const xml = await fetchRss(src.rssUrl)
      const parsed = dedupByExternalId(parseRssXml(xml))
      const existing = await getExistingExternalIds(src.id)
      const fresh = parsed.filter(e => !existing.has(e.externalId))
      const rows = buildUpsertRows(fresh, src.id)
      const insertedIds = await insertNewsItems(rows)
      totalInserted += insertedIds.length
      // 先 push、之後**就地累加**：抓正文途中 throw 時，已經插入的則數與已經累加的計數
      // 都留在這一筆裡（catch 只補上 failed 標記）。計數欄位一律從 newTally() 展開、
      // 不要手抄一份零值——加計數器時手抄的地方會漏，而測試不會紅（測試檔不在
      // type-check 範圍內），只有 tsc 會叫。
      // `current` 是同一個物件、只是不帶 `| null`——閉包裡（pMap 的 callback）拿 `entry`
      // 會被 TS 放寬回可為 null，用一個 const 綁住就不必到處 assert。
      const current: PerSourceEntry = { slug: src.slug, inserted: insertedIds.length, failed: false, ...newTally() }
      entry = current
      perSource.push(current)
      console.warn(`[runNewsRefresh] ${src.slug}: ${insertedIds.length} new`)

      const toScrape = await getNewsItemsByIds(insertedIds)
      // 整個 feed 是 Google News 代理（`isGoogleNewsProxySeed`）時，整批跳過抓正文：
      // 轉址頁本身就拿不到正文（見 `resolveArticleTarget` 的註解），讀者拿到的是標題與
      // 轉址連結，需要正文得自行以合法方式取得（見 docs/architecture/news-corpus-systems.md）。
      const feedDenied = isGoogleNewsProxySeed(src)
      if (feedDenied && toScrape.length > 0) {
        current.feedSkipped = toScrape.length
        console.warn(`[runNewsRefresh] ${src.slug}: ${toScrape.length} 篇跳過抓正文（Google News 代理來源）`)
      }
      const attempted = feedDenied ? [] : toScrape
      // 計數直接累加進 entry（它是 SourceTally 的超集）。perSource 會被 index.ts 的
      // makeMetadata 原樣寫進 background_jobs.metadata，所以這些數字是**查得到**的——
      // 不像 console 只活在容器 log。
      await pMap(attempted, concurrency, item => fetchAndStoreBody(item, src.slug, current))
      // 分母是**真的試過**的篇數：feed 層跳過的那些從來沒有嘗試抓取，算進去會讓
      // 「N/M 篇失敗」的 M 憑空變大。
      logTally(src.slug, attempted.length, current)

      // 批次分類新進 items（非阻擋；categorizer 失敗則 category 留 null、selection 退來源層）
      try {
        await categorizeAndStore(toScrape.map(it => ({ id: it.id, title: it.title, contentText: it.contentText })))
      }
      catch (catErr) {
        console.warn(`[runNewsRefresh] ${src.slug} categorize failed (items stay null):`, catErr)
      }

      // 批次標 topic_tags（非阻擋；tagger 失敗則 taggedAt 留 null、selection 退 alias）
      try {
        await tagAndStore(toScrape.map(it => ({ id: it.id, title: it.title, contentText: it.contentText })))
      }
      catch (tagErr) {
        console.warn(`[runNewsRefresh] ${src.slug} tagging failed (items stay untagged):`, tagErr)
      }
    }
    catch (err) {
      sourcesFailed += 1
      // 已經有一筆就只補標記，不要再 push 第二筆。這樣「插入成功但抓正文途中
      // 失敗」那一列同時看得到真實的 inserted／計數與 failed。
      if (entry === null)
        perSource.push({ slug: src.slug, inserted: 0, failed: true, ...newTally() })
      else
        entry.failed = true
      console.error(`[runNewsRefresh] ${src.slug} failed, skipping:`, err)
    }
  }
  console.warn(`[runNewsRefresh] done, total ${totalInserted} new items (failed sources: ${sourcesFailed})`)
  return {
    sourcesProcessed: sources.length,
    sourcesFailed,
    totalInserted,
    perSource,
  }
}
