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
}

// ★ 預設 seed policy：下面每一筆的 `isActive` 是**宣告值**。乾淨 clone
// 跑 `db:seed` 實際寫進 DB 的啟用狀態改由 `main()` 透過 `effectiveEnabled()` 算：
// 宣告 active 的來源裡，只有落在 `source-policy.ts` `OFFICIAL_SOURCE_DOMAINS`
// 的官方網域（如 `cbc-press`、`eia`）會照常啟用；其餘商業媒體來源預設停用，
// 需要設 `SEED_THIRD_PARTY_SOURCES=true` 才會被啟用。理由：這個檔案本身有 23 筆
// 商業媒體 feed（跨 11 個不同網域；19 是這個檔案與 `seed-external-sources.ts` 合計的
// distinct 商業網域數，兩邊各自的商業 feed 筆數不是 19），各站有自己的使用條款，
// 要不要抓、能不能抓由使用者自己確認後再開啟。宣告 `isActive: false`
// 的來源（壞掉而停用）不受這個 gate 影響，一律維持停用。
export const SEED: readonly SeedEntry[] = [
  { slug: 'cna', displayName: '中央社財經', rssUrl: 'https://feeds.feedburner.com/rsscna/finance', isActive: true, category: 'tw-equity' },
  { slug: 'google-news-fin', displayName: 'Google News 財經', rssUrl: 'https://news.google.com/rss/search?q=%E5%8F%B0%E8%82%A1+%E8%B2%A1%E7%B6%93&hl=zh-TW&gl=TW&ceid=TW:zh-Hant', isActive: true, category: 'tw-equity' },
  { slug: 'ltn-business', displayName: '自由時報財經', rssUrl: 'https://news.ltn.com.tw/rss/business.xml', isActive: true, category: 'tw-equity' },
  // ── 台股出版社來源 ──
  // ★ 2026-08-28：cnyes／udn／yahoo-stock 三個從 Google News site: 代理換成發行商
  //   直連 feed。代理的 <link> 指向 news.google.com 的轉址頁，scraper 抓回來的
  //   content_text 只有錨點 markup（非空、幾百字元，剝掉標記剛好等於標題），所以這三個
  //   來源合計 11,184 篇對報告的貢獻是**零正文**。三個直連 feed 當天實測：item 全非空、
  //   pubDate 是當天、且真的跑一次 scrapeArticle 抓得到 547～3,603 字的正文。
  // ★ slug 保留 `google-news-` 前綴是歷史包袱、不是筆誤：seed 以 slug 為 upsert 鍵，改名
  //   會新建一列而把舊列留成 active，等於同一個來源被抓兩次。要改名得配一支 migration。
  { slug: 'google-news-cnyes', displayName: '鉅亨網', rssUrl: 'https://news.cnyes.com/rss/v1/news/category/tw_stock', isActive: true, category: 'tw-equity' },
  { slug: 'google-news-udn', displayName: '經濟日報', rssUrl: 'https://money.udn.com/rssfeed/news/1001/5591?ch=money', isActive: true, category: 'tw-equity' },
  { slug: 'google-news-yahoo-stock', displayName: 'Yahoo 股市', rssUrl: 'https://tw.stock.yahoo.com/rss?category=news', isActive: true, category: 'tw-equity' },
  // ctee 沒有可用的公開 feed，且站方 robots.txt 不允許自動化存取；這一筆只透過
  // Google News 的搜尋 feed 取得標題與連結，不抓該站的頁面（見 body-fetch-policy.ts）。
  // ★ 這一點對**所有** `google-news-*` 前綴（及 `bloomberg-markets`／`wsj-markets`）的
  //   Google News 代理來源同樣成立，不是 ctee 特例：這批來源在 `news-refresh` 的 feed
  //   層整批跳過抓正文（`isGoogleNewsProxySeed`，見 `refresh.ts`），讀者拿到的一律是
  //   標題與轉址連結。需要正文請改用發行商自己的公開 feed（上面 cnyes／udn／
  //   yahoo-stock 是先例），或自行在 `refresh.ts` 的 `resolveArticleTarget`／
  //   `fetchAndStoreBody` 接上 URL 解析。
  { slug: 'google-news-ctee', displayName: '工商時報（Google News）', rssUrl: 'https://news.google.com/rss/search?q=site:ctee.com.tw&hl=zh-TW&gl=TW&ceid=TW:zh-Hant', isActive: true, category: 'tw-equity' },
  // ── 2026-08-28：補有正文的新聞來源 ──
  // 挑選方式是先量再加，四個判準全部實測過：feed 回得了 200 且 item 非空、
  // pubDate 是當天、`scrapeArticle` 對它的文章頁抓得到正文、以及**與既有來源不重複**。
  //
  // ★ 「同一個 publisher 多開分類」比「找新 publisher」划算得多：這一輪看過的其他
  //   publisher 都沒有提供可用的公開 feed，而已經有公開 feed 的 host 上還有沒開的分類。
  //
  // ★ 加分類前一定要量重疊。cnyes 的 `headline` 與現有 `tw_stock` 重疊 45%、`future`
  //   與 `headline` 重疊 66%，加了是灌近重複——那正是 2026-07 「近重複灌爆 top-36」
  //   的成因，後來得靠 story-level 去重與 per-storyline cap 收拾。`wd_stock` 與
  //   `tw_stock` 重疊 **0%**，所以只加它。money.udn.com 的六個分類兩兩交集只有 1 篇。
  // 壹蘋是這一輪唯一有規模的新 publisher（250 則/次、正文 3277 字），但財經內容
  // 調性偏軟，所以 `SOURCE_WEIGHTS` 給 0.9 讓它在選稿時吃虧——素材層寧可先有，
  // 選稿層再壓。用 `category` 的 `finance` 分類而不是 `latest`：後者是全站混合
  // （娛樂／生活／國際都在裡面），兩者只重疊 16/250。
  { slug: 'nextapple-finance', displayName: '壹蘋新聞網財經', rssUrl: 'https://news.nextapple.com/api/rss/category/finance', isActive: true, category: 'tw-equity' },
  { slug: 'technews', displayName: 'TechNews 科技新報', rssUrl: 'https://technews.tw/feed/', isActive: true, category: 'macro' },
  { slug: 'cnyes-world', displayName: '鉅亨網國際股市', rssUrl: 'https://news.cnyes.com/rss/v1/news/category/wd_stock', isActive: true, category: 'macro' },
  // udn 的分類只有數字 ID、channel title 全部一樣是「經濟日報」，所以靠內容認：
  // 5591（既有）產業個股／5590 台股盤勢與外資／5588 國際財經。刻意不加 5589（中國，
  // 與 google-news-china 同一個 beat）、5592（綜合、與其他三個混）與 12017（金融財報，
  // 太窄）——多開一個分類就多一個 udn 佔選稿名額，而來源多樣性是 per-source 判的。
  { slug: 'udn-markets', displayName: '經濟日報台股', rssUrl: 'https://money.udn.com/rssfeed/news/1001/5590?ch=money', isActive: true, category: 'tw-equity' },
  { slug: 'udn-global', displayName: '經濟日報國際', rssUrl: 'https://money.udn.com/rssfeed/news/1001/5588?ch=money', isActive: true, category: 'macro' },
  // ── 總經/國際/能源（reachability 全數驗證通過；繁中 Google News 查詢沿用 google-news-fin pattern）──
  { slug: 'google-news-us-macro', displayName: '美國總經（Google News）', rssUrl: 'https://news.google.com/rss/search?q=%E7%BE%8E%E5%9C%8B+%E9%80%9A%E8%86%A8+OR+CPI+OR+%E8%81%AF%E6%BA%96%E6%9C%83&hl=zh-TW&gl=TW&ceid=TW:zh-Hant', isActive: true, category: 'macro' },
  { slug: 'google-news-oil', displayName: '油價能源（Google News）', rssUrl: 'https://news.google.com/rss/search?q=%E6%B2%B9%E5%83%B9+OR+%E5%8E%9F%E6%B2%B9+OR+OPEC&hl=zh-TW&gl=TW&ceid=TW:zh-Hant', isActive: true, category: 'macro' },
  { slug: 'google-news-cbc', displayName: '央行貨幣政策（Google News）', rssUrl: 'https://news.google.com/rss/search?q=%E5%A4%AE%E8%A1%8C+%E5%88%A9%E7%8E%87+OR+%E8%B2%A8%E5%B9%A3%E6%94%BF%E7%AD%96&hl=zh-TW&gl=TW&ceid=TW:zh-Hant', isActive: true, category: 'macro' },
  { slug: 'google-news-china', displayName: '中國經濟（Google News）', rssUrl: 'https://news.google.com/rss/search?q=%E4%B8%AD%E5%9C%8B+%E7%B6%93%E6%BF%9F+OR+%E5%87%BA%E5%8F%A3+OR+%E8%A3%BD%E9%80%A0%E6%A5%AD&hl=zh-TW&gl=TW&ceid=TW:zh-Hant', isActive: true, category: 'macro' },
  { slug: 'eia', displayName: 'U.S. EIA Today in Energy', rssUrl: 'https://www.eia.gov/rss/todayinenergy.xml', isActive: true, category: 'macro' },
  { slug: 'oilprice', displayName: 'OilPrice.com', rssUrl: 'https://oilprice.com/rss/main', isActive: true, category: 'macro' },
  { slug: 'cnbc-markets', displayName: 'CNBC Markets', rssUrl: 'https://www.cnbc.com/id/15839135/device/rss/rss.html', isActive: true, category: 'macro' },
  { slug: 'bloomberg-markets', displayName: 'Bloomberg Markets（Google News proxy）', rssUrl: 'https://news.google.com/rss/search?q=site:bloomberg.com+markets&hl=en', isActive: true, category: 'macro' },
  { slug: 'wsj-markets', displayName: 'WSJ Markets（Google News proxy）', rssUrl: 'https://news.google.com/rss/search?q=site:wsj.com+markets&hl=en', isActive: true, category: 'macro' },
  // ── 2026-08-28：一手官方來源（保留席用）──
  // ★ 這個 slug 同時存在於 `external_sources`（Cascade 檢索與 officialBlock 用同一個 feed）。
  //   **重複是刻意的**：兩張表是兩套獨立的抓取系統，而重大公告要能當日報主題就必須在
  //   `news_items` 裡有真的 id——選稿、`selected_news_ids`、analyze job 的 FK、讀者面的
  //   「看分析」連結全都吃那個 id。一度試過讓公告帶負數 id 直接插進選稿結果，
  //   獨立複查抓到兩個實際回歸（analyze payload 撞 `.positive()`、
  //   `getNewsItemsByIds` 用 `inArray` 查不到而讀者面少一則），所以改走這條。
  // ★ 例行月報一起進池子是可接受的：官方公告用新聞的尺量必然低分（實測最佳名次 206、
  //   中位 4,197），選不上；真正要出場的那幾則走保留席，不靠排序。
  { slug: 'cbc-press', displayName: '中央銀行新聞稿', rssUrl: 'https://www.cbc.gov.tw/tw/rss-302-1.xml', isActive: true, category: 'macro' },
  // ── 全球產業經濟 / 多邊金融（補 2026-06-16 eval 漏題：AI 模型定價、亞開銀/IMF 等；英文 Google News proxy、走 Google IP）──
  { slug: 'google-news-ai-econ', displayName: 'AI 產業經濟（Google News）', rssUrl: 'https://news.google.com/rss/search?q=AI+model+pricing+OR+OpenAI+OR+inference+cost&hl=en', isActive: true, category: 'macro' },
  { slug: 'google-news-global-macro-fin', displayName: '全球市場/多邊金融（Google News）', rssUrl: 'https://news.google.com/rss/search?q=emerging+markets+OR+MSCI+OR+IMF+OR+%22Asian+Development+Bank%22&hl=en', isActive: true, category: 'macro' },
  // ── 2026-09-07：Yahoo 的第二個財經 feed ──
  // 照本檔「先量再加」的四個判準實測（2026-09-07、本機 IP）：feed 200、30 則 item
  // description 全非空（中位 241 字）、pubDate 全是當天（最舊 06:41、最新 07:28）。
  // 文章頁與既有 `google-news-yahoo-stock` 同一個 host（`tw.stock.yahoo.com/news/...`），
  // 不需要新的抓取設定——對本 feed 的前三則實跑 `scrapeArticle`，3/3 抓到 4145–4476 字正文。
  //
  // ★ **重疊是這一列唯一的風險，數字要看著決定**：同一時點抓兩個 feed 比對，
  //   30 則裡有 9 則 link、11 則標題已經在 `google-news-yahoo-stock` 當下的 50 則窗內
  //   （30%／37%）。這是**下界**——兩個 feed 的窗長不同，早滾掉或還沒進來的算不到。
  //   本檔既有的判準線：cnyes `headline` 對 `tw_stock` 重疊 45% 被否決、`wd_stock` 0%
  //   被採用。這一列落在中間，取捨是「素材層寧可先有、選稿層再壓」，同時靠 category
  //   分流降低直接互相排擠。
  // ★ category 取 `macro` 而不是跟 yahoo-stock 一樣的 `tw-equity`：同一份 30 則抽樣裡
  //   明顯台股題只有 8 則，其餘是國際盤勢、中韓經濟與供應鏈產業題（SK 海力士、XR 出貨、
  //   歐股）。來源層 category 是候選池的 2-strata 分流，分錯會讓兩個 Yahoo feed 擠同一格。
  { slug: 'yahoo-finance', displayName: 'Yahoo 財經', rssUrl: 'https://tw.news.yahoo.com/rss/finance', isActive: true, category: 'macro' },
]

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
export const RETIRED_SLUGS: readonly string[] = Object.freeze(['anue', 'tvbs', 'udn-money'])

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
