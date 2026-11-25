import type { NewsCategory } from './news-categories.js'
import process from 'node:process'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { closeDb, getDb } from './client.js'
import { newsSources } from './schema.js'
import { applySeedGate, downgradeAllowed, shouldBlockDowngrade, thirdPartySourcesEnabled } from './source-policy.js'

export interface SeedEntry {
  slug: string
  displayName: string
  rssUrl: string
  isActive: boolean
  category: NewsCategory
  content: 'full' | 'feed-excerpt' | 'title-only'
}

// 每一筆的 feed、條款連結與允許用法記在 docs/sources.md，新增來源要先改那份（seed-sources.test.ts 守）。
//
// `isActive` 是宣告值；寫進 DB 的啟用狀態由 `RESOLVED_SEED_GATE` 算：官方網域
// （`source-policy.ts` 的 `OFFICIAL_SOURCE_DOMAINS`）直接啟用，其餘要設
// `SEED_THIRD_PARTY_SOURCES=true`。
//
// `content` 由各站條款與 robots 決定：
// - full：可抓正文（政府資料開放授權或公共領域）。
// - feed-excerpt：只存 feed 給的前言，不抓文章頁（條款僅提供前言，或站方限制抓取頻率）。
// - title-only：只存標題與連結（ADR 0007，條款禁轉載內容）。
export const SEED: readonly SeedEntry[] = [
  // slug 保留 `google-news-` 前綴是歷史包袱：seed 以 slug 為 upsert 鍵，改名會多一列。
  { slug: 'google-news-cnyes', displayName: '鉅亨網台股', rssUrl: 'https://news.cnyes.com/rss/v1/news/category/tw_stock', isActive: true, category: 'tw-equity', content: 'title-only' },
  { slug: 'cnyes-world', displayName: '鉅亨網國際股市', rssUrl: 'https://news.cnyes.com/rss/v1/news/category/wd_stock', isActive: true, category: 'macro', content: 'title-only' },
  { slug: 'cna', displayName: '中央社財經', rssUrl: 'https://feeds.feedburner.com/rsscna/finance', isActive: true, category: 'tw-equity', content: 'feed-excerpt' },
  { slug: 'cbc-press', displayName: '中央銀行新聞稿', rssUrl: 'https://www.cbc.gov.tw/tw/rss-302-1.xml', isActive: true, category: 'macro', content: 'full' },
  { slug: 'fsc-press', displayName: '金管會新聞稿', rssUrl: 'https://www.fsc.gov.tw/RSS/Messages?serno=201202290009&language=chinese', isActive: true, category: 'macro', content: 'full' },
  { slug: 'ey-press', displayName: '行政院新聞', rssUrl: 'https://www.ey.gov.tw/RSS_Content.aspx?ModuleType=3', isActive: true, category: 'macro', content: 'full' },
  { slug: 'president-news', displayName: '總統府新聞', rssUrl: 'https://www.president.gov.tw/RSSNEWS.aspx', isActive: true, category: 'macro', content: 'full' },
  { slug: 'mofa-press', displayName: '外交部新聞稿', rssUrl: 'https://www.mofa.gov.tw/OpenData.aspx?SN=E0AB271EE713F7E8', isActive: true, category: 'macro', content: 'full' },
  { slug: 'cdc-press', displayName: '疾管署新聞稿', rssUrl: 'https://www.cdc.gov.tw/RSS/RssXml/Hh094B49-DRwe2RR4eFfrQ?type=1', isActive: true, category: 'macro', content: 'full' },
  { slug: 'fed-press', displayName: '聯準會新聞稿', rssUrl: 'https://www.federalreserve.gov/feeds/press_all.xml', isActive: true, category: 'macro', content: 'full' },
  { slug: 'whitehouse-news', displayName: '白宮新聞', rssUrl: 'https://www.whitehouse.gov/news/feed/', isActive: true, category: 'macro', content: 'full' },
  // robots 宣告 crawl-delay 5 秒，併發抓文章頁會違反，所以只用 feed。
  { slug: 'state-press', displayName: '美國國務院新聞稿', rssUrl: 'https://www.state.gov/rss-feed/press-releases/feed/', isActive: true, category: 'macro', content: 'feed-excerpt' },
  // robots 宣告 Request-rate 1/60，同上。
  { slug: 'gdacs', displayName: 'GDACS 全球災害警報', rssUrl: 'https://www.gdacs.org/xml/rss.xml', isActive: true, category: 'macro', content: 'feed-excerpt' },
]

export const NO_BODY_FETCH_SLUGS: readonly string[] = SEED.filter(s => s.content !== 'full').map(s => s.slug)
export const EXCERPT_STRIPPED_SLUGS: readonly string[] = SEED.filter(s => s.content === 'title-only').map(s => s.slug)

/**
 * 這個來源是不是 Google News 代理（feed 是 news.google.com 的搜尋結果）。
 *
 * 判 `rss_url` 的 host、**不判 slug 也不判 displayName**：`bloomberg-markets` 與
 * `wsj-markets` 兩個名字完全看不出是代理，用名字猜會漏掉。與 corpus 那邊的
 * `isAggregatorProxySeed` 是同一個判準，只是兩張表各有自己的來源清單。
 */
export function isGoogleNewsProxySeed(seed: Pick<SeedEntry, 'rssUrl'>): boolean {
  try {
    return new URL(seed.rssUrl).host === 'news.google.com'
  }
  catch {
    return false
  }
}

/**
 * 已知「有列、但一列都不能用」且**明示接受不告警**的日報來源。
 *
 * 為什麼需要：`/api/ops/publication-status` 的 `newsSources` 會判 zeroUsable——窗內有
 * 抓到新聞、但一則都沒有超出標題的資訊。Google News 代理的 `content_text` 是錨點
 * markup（`<a href="https://news.google.com/rss/articles/…">標題</a>` 加發行商），
 * **非空但資訊量為零**，所以任何以「非空」為準的檢查都會給假綠，而以
 * `hasBodyBeyondTitle` 為準的檢查會對它們全部開火。那是 feed 本身的形狀，不是回歸。
 *
 * 2026-08-23 對 prod 近 7 天實測：18 個啟用來源裡「一則都沒有超出標題」的正好是這批
 * 代理（**當時 13 個**），其餘 5 個（`ltn-business` 160/160、`cna` 67/67、`oilprice`
 * 41/41、`cnbc-markets` 12/12、`eia` 2/2）全數通過。有這份清單首日 firing 是 0/18，
 * 沒有是 13/18。
 *
 * ★ **那個 13 是 2026-08-23 的觀測值，不是常數。** 2026-08-28 把
 * `google-news-cnyes`／`-udn`／`-yahoo-stock` 換成發行商直連 feed，它們因此離開這份
 * 清單、剩 10 個——**那是刻意的**，它們現在受 zeroUsable 告警管轄。當下到底幾個一律
 * 跑 `pnpm --filter server run news:health` 看，不要引用任何文件裡寫死的數字。
 *
 * ★ **不要為了讓告警閉嘴就往這裡加 slug。** 一個非代理來源掉到零可用，代表它的新聞
 * 從此對報告沒有貢獻——要修的是那個來源的正文抓取，不是告警。清單是**推導**的
 * （見 `isGoogleNewsProxySeed`），所以把某個來源的 feed 換成 news.google.com 等於
 * 偷偷加進豁免清單；換 feed 的那個 diff 會同時看到這段註解。
 *
 * ★ **清單裡每一筆的零可用正文是結構性的，不是等修的暫時狀態。** 這批來源的 `<link>` 是
 * Google 的轉址頁，`news-refresh` 在 feed 層就整批跳過抓正文（見 `refresh.ts`）。除非換掉
 * feed 本身（同 cnyes／udn／yahoo-stock 的先例），否則不會有機制讓它們離開這份清單。
 */
export const ACCEPTED_ZERO_USABLE_NEWS_SLUGS: readonly string[] = Object.freeze(
  SEED.filter(s => s.isActive && isGoogleNewsProxySeed(s)).map(s => s.slug),
)

/**
 * 退役來源：曾經有設定、現在確定不能用，且**不打算再回來**。
 *
 * 為什麼需要一份清單而不是直接把那幾列從 `SEED` 刪掉：`main()` 只做 upsert，
 * 刪掉陣列裡的一列等於把 DB 的狀態**凍結在當下**——本機 DB 的 `anue` 與
 * `udn-money` 之前都還是 `is_active = t`，光刪陣列它們會繼續被抓。
 *
 * 只停用、不刪列：`news_items.source_id` 有 FK 指過來，刪列會在有歷史文章的環境
 * 直接炸掉 seed。停用之後 `getActiveSources()` 就看不到它們，而 `news:health`
 * 仍會把它們列成 `off`——「有列、停用、零則」是看得見的狀態，比消失好。
 *
 * 2026-08-28 退役的三個（實測，非推測）：
 * - `anue`：`news.cnyes.com/rss/cat/tw_stock` 404（改用 `/rss/v1/...` 那條，已接到
 *   `google-news-cnyes` 上）。
 * - `tvbs`：`news.tvbs.com.tw/rss/news-fn.xml` 404。
 * - `udn-money`：`udn.com/rssfeed/news/2/6638` 回 **HTTP 200 且有 20 個 `<item>`**，
 *   但 title／link／description 全空、pubDate 是 `Thu, 01 Jan 1970`。它零篇的真正
 *   原因是這個——**「200」判不出這件事**。
 */
export const RETIRED_SLUGS: readonly string[] = Object.freeze([
  'anue',
  'tvbs',
  'udn-money',
  // 2026-11-08（#24）：Google News 代理移除；其餘來源條款或 robots 不允許本用途，理由見 docs/sources.md。
  'google-news-fin',
  'google-news-udn',
  'google-news-yahoo-stock',
  'google-news-ctee',
  'google-news-us-macro',
  'google-news-oil',
  'google-news-cbc',
  'google-news-china',
  'google-news-ai-econ',
  'google-news-global-macro-fin',
  'bloomberg-markets',
  'wsj-markets',
  'ltn-business',
  'nextapple-finance',
  'technews',
  'udn-markets',
  'udn-global',
  'eia',
  'oilprice',
  'cnbc-markets',
  'yahoo-finance',
])

// `SEED_THIRD_PARTY_SOURCES` 在 module 頂層讀一次（`db:seed` 的 tsx CLI 用
// `--env-file-if-exists` 在 import 前就把 .env 載好，所以這裡讀到的跟原本在
// `main()` 裡讀的是同一個值，行為不變）。刻意搬到頂層、不留在 `main()` 裡：這樣
// `RESOLVED_SEED_GATE` 才能在**import 當下**就算好，讓測試不必連 DB、不必真的
// 執行 CLI 就能斷言「optIn 沒開時，最終真的只有幾筆會被啟用」。
const optIn = thirdPartySourcesEnabled()

/**
 * `SEED` 套用第三方來源 gate 後的結果——CLI 的 `main()` 與測試共用同一份計算，
 * 不是各自重算一次（重算兩次遲早會分岔）。
 */
export const RESOLVED_SEED_GATE = applySeedGate(
  SEED,
  optIn,
  s => ({ slug: s.slug, urls: [s.rssUrl], declared: s.isActive }),
)

async function main() {
  const db = getDb()
  const { gated, withheldSlugs } = RESOLVED_SEED_GATE
  if (!optIn && withheldSlugs.length > 0) {
    console.warn(
      `[db:seed] ★ 第三方來源預設停用：${withheldSlugs.length} 筆商業媒體來源這次不會被啟用`
      + `（${withheldSlugs.join(', ')}）。`,
    )
    console.warn(
      '[db:seed] 要啟用它們，請設定環境變數 SEED_THIRD_PARTY_SOURCES=true 再重跑 db:seed。'
      + '這些來源是第三方媒體，開啟前請自行確認各站 ToS 與 robots.txt。',
    )
  }
  // 拒絕靜默降級：在寫任何東西進 news_sources 之前，先查 DB 裡有幾筆會被這次 gate
  // 擋下的來源目前其實是啟用中的——那代表作者手動啟用過，這次跑會把它們悄悄關掉。
  // withheldSlugs 為空就不用查（省一次 round-trip，也避免 IN () 空陣列）。
  const allowDowngrade = downgradeAllowed()
  let enabledThirdParty: string[] = []
  if (withheldSlugs.length > 0) {
    const rows = await db.select({ slug: newsSources.slug })
      .from(newsSources)
      .where(and(inArray(newsSources.slug, withheldSlugs), eq(newsSources.isActive, true)))
    enabledThirdParty = rows.map(r => r.slug)
  }
  if (shouldBlockDowngrade(enabledThirdParty, optIn, allowDowngrade)) {
    console.error(
      `[db:seed] ✗ 中止：這次會把 ${enabledThirdParty.length} 筆目前啟用中的第三方來源`
      + `翻成停用（${enabledThirdParty.join(', ')}）。`,
    )
    console.error(
      '[db:seed] 這些來源目前是 is_active = true，代表先前曾經明確啟用過；直接跑下去會'
      + '在沒有任何提示下讓它們停用，隔天日報選稿的素材會明顯變少。',
    )
    console.error(
      '[db:seed] 請二選一：設定 SEED_THIRD_PARTY_SOURCES=true 繼續抓第三方來源；'
      + '或設定 SEED_ALLOW_DOWNGRADE=true 明確表示你確認要停用它們。',
    )
    process.exit(1)
  }
  for (const { entry: s, resolvedEnabled } of gated) {
    // news_sources 沒有 category 欄（category 只在 code 層）；只 insert DB 實際欄位
    await db.insert(newsSources)
      .values({ slug: s.slug, displayName: s.displayName, rssUrl: s.rssUrl, isActive: resolvedEnabled })
      .onConflictDoUpdate({
        target: newsSources.slug,
        set: { displayName: s.displayName, rssUrl: s.rssUrl, isActive: resolvedEnabled },
      })
  }
  // 退役來源：停用而不刪列（理由見 RETIRED_SLUGS 的註解）。這一步是 idempotent 的，
  // 已經停用的列 UPDATE 不到東西也不會出錯。
  if (RETIRED_SLUGS.length > 0) {
    const deactivated = await db.update(newsSources)
      .set({ isActive: false })
      .where(and(inArray(newsSources.slug, [...RETIRED_SLUGS]), eq(newsSources.isActive, true)))
      .returning({ slug: newsSources.slug })
    console.warn('[db:seed] retired sources deactivated =', deactivated.map(r => r.slug))
  }
  const count = await db.execute(sql`SELECT COUNT(*)::int AS n FROM news_sources`)
  console.warn('[db:seed] news_sources count =', count)
  await closeDb()
}

// CLI entry（對齊 seed-external-sources.ts；import 時不執行、tsx 直跑時才執行）
if (import.meta.url === `file://${process.argv[1]}`) {
  main().then(() => process.exit(0)).catch((err) => {
    console.error('[db:seed] failed:', err)
    process.exit(1)
  })
}
