import process from 'node:process'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from './client.js'
import { externalSources } from './schema.js'
import { applySeedGate, collectHttpUrls, downgradeAllowed, shouldBlockDowngrade, thirdPartySourcesEnabled } from './source-policy.js'

const RssConfigSchema = z.object({
  feedUrl: z.string().url(),
  format: z.enum(['rss', 'atom', 'cnyes-json']).optional().default('rss'),
  encoding: z.string().optional(),
})

const HtmlSelectorConfigSchema = z.object({
  listingUrl: z.string().url(),
  itemSelector: z.string().min(1),
  titleSelector: z.string().min(1),
  linkSelector: z.string().min(1),
  dateSelector: z.string().min(1),
  /**
   * 文章頁正文容器的 selector。**必填、可為 null**——不是 optional。
   *
   * 理由是：列表頁只給標題與網址，沒有這一格的來源抓回來的每一篇都是
   * `excerpt: null`，於是不會被 enrich、`entities` 與 `topic_tags` 留空，而 retriever
   * 的兩條路徑都是 jsonb containment，空陣列永不命中——那些列寫進 DB 之後在檢索裡
   * 不可達，而 SLO 只數列數、顯示健康。`fsc-news` 修好 selector 後真的抓到 15 篇，
   * 15 篇全部不可用，比修之前更難發現。
   *
   * 必填是這件事的 forcing function：新增 html-selector 來源時 TS 會逼你回答
   * 「正文在哪一個容器」，答不出來就明寫 `null`（＝這個來源刻意不抓正文），
   * 而不是靜靜地產出一批不可檢索的列。
   *
   * ★ 改成必填之後，**DB 裡舊的 config 會通不過這個 schema**——`corpus-worker`
   *   的 `defaultListSources` 在 DB boundary 做 safeParse，parse 失敗的來源會被
   *   記 warn 並跳過。所以部署新版之後**要重跑一次 seed**，否則這兩個 html-selector
   *   來源會整輪被略過（會被「來源零產出」那類檢查接住，但那是白吵一輪）。
   */
  bodySelector: z.string().min(1).nullable(),
  headers: z.record(z.string(), z.string()).optional(),
  encoding: z.string().optional(),
})

// 對齊 DB CHECK constraint 既有的 'official-feed' kind。
// Tier 1 或 2 皆可（例：Fed FOMC atom feed = tier 2、未來某 official RSS = tier 1）。
const OfficialFeedConfigSchema = z.object({
  feedUrl: z.string().url(),
  // twse-news-json 是 2026-08-22 為 TWSE OpenAPI 加的。放在這裡而不是 RssConfigSchema，
  // 因為 rss kind 綁 tier 1、官方來源是 tier 2——只有 official-feed 兩種 tier 都收。
  // 兩個 kind 在 dispatcher.ts:13-14 走同一條 fetchRssSource，所以 parser 不必分兩份。
  format: z.enum(['atom', 'rss', 'twse-news-json']),
  encoding: z.string().optional(),
})

export const ExternalSourceSeedSchema = z.discriminatedUnion('kind', [
  z.object({
    slug: z.string().min(1),
    displayName: z.string().min(1),
    kind: z.literal('rss'),
    tier: z.literal(1),
    config: RssConfigSchema,
    enabled: z.boolean().optional(),
  }),
  z.object({
    slug: z.string().min(1),
    displayName: z.string().min(1),
    kind: z.literal('html-selector'),
    tier: z.literal(2),
    config: HtmlSelectorConfigSchema,
    enabled: z.boolean().optional(),
  }),
  z.object({
    slug: z.string().min(1),
    displayName: z.string().min(1),
    kind: z.literal('official-feed'),
    tier: z.union([z.literal(1), z.literal(2)]),
    config: OfficialFeedConfigSchema,
    enabled: z.boolean().optional(),
  }),
])

// Use z.input so optional fields with defaults (e.g. RssConfig.format) remain optional in TS.
export type ExternalSourceSeed = z.input<typeof ExternalSourceSeedSchema>

// ★ 預設 seed policy：下面每一筆的 `enabled`（含未寫、預設 true）是**宣告值**。
// 乾淨 clone 跑 `seed:external-sources` 實際寫進 DB 的啟用狀態改由
// CLI entry 透過 `effectiveEnabled()` 算：宣告 enabled 的來源裡，只有 config 內
// 每一個 URL 都落在 `source-policy.ts` `OFFICIAL_SOURCE_DOMAINS` 的官方網域
// （`cbc-press`、`eia`、`ey-press`、`fomc-statements`、`fsc-news`、
// `twse-mops-news`、`twse-announcements`、`whitehouse-statements`）會照常啟用；
// 其餘商業媒體來源預設停用，需要設 `SEED_THIRD_PARTY_SOURCES=true` 才會被啟用。
// `enabled: false` 的來源（壞掉而停用，如 `commercial-times`／`moneydj`）不受這個
// gate 影響、一律維持停用。
//
// ★ `seedExternalSources()` 本身**不做**這個 gate——它是忠實 upsert 呼叫端傳進來的
// 任何內容（`seed-external-sources.db.test.ts` 用合成 fixture 直接驗證這件事）。
// gate 只加在檔尾 CLI entry，對 `EXTERNAL_SOURCES_SEED` map 過再傳進去。
export const EXTERNAL_SOURCES_SEED: readonly ExternalSourceSeed[] = [
  // Tier 1 · RSS · baseline (10 家、台美經濟核心)
  { slug: 'anue', displayName: '鉅亨網頭條', kind: 'rss', tier: 1, config: { feedUrl: 'https://api.cnyes.com/media/api/v1/newslist/category/headline?limit=30', format: 'cnyes-json' } },
  // 2026-08-22 停用：這個 feed 已不存在（回 404），首頁也沒有 RSS autodiscovery。
  // ★ 同樣沒有復活偵測（理由同 commercial-times）。人手複查：
  //   curl -s -o /dev/null -w '%{http_code}' https://news.moneydj.com/z/rss/all.xml
  { slug: 'moneydj', displayName: 'MoneyDJ 理財網', kind: 'rss', tier: 1, enabled: false, config: { feedUrl: 'https://news.moneydj.com/z/rss/all.xml' } },
  // 舊路徑帶子分類代碼 7240/7241，回合法 XML 但 items=0（代碼已失效）。2026-08-17 查證、08-21 複驗。
  // 2026-08-22 停用：feed 本身是好的，但這個網域對部分網路環境的自動化請求回 403；
  // 站方不歡迎就不抓，故停用。
  { slug: 'udn-money', displayName: '經濟日報', kind: 'rss', tier: 1, enabled: false, config: { feedUrl: 'https://money.udn.com/rssfeed/news/1001?ch=money' } },
  { slug: 'cnyes-global', displayName: '鉅亨國際', kind: 'rss', tier: 1, config: { feedUrl: 'https://api.cnyes.com/media/api/v1/newslist/category/wd_stock?limit=30', format: 'cnyes-json' } },
  // 2026-08-22 停用：站方不允許自動化存取（feed 一律回 403），故停用。
  // ★ 停用的代價：getSourceActivity 只看 enabled=true，所以它從此不進靜默判定——
  //   站方哪天重新開放 feed 不會有任何機制通知，只能人手複查。
  { slug: 'commercial-times', displayName: '工商時報', kind: 'rss', tier: 1, enabled: false, config: { feedUrl: 'https://ctee.com.tw/feed' } },
  // 舊路徑在 ec. 子網域、已棄用（回 200 但 body 是 HTML 錯誤頁「網址錯誤 - 自由財經」）。
  // 對照組 liberty-international 用 news. 子網域、一直正常——差異就是子網域本身。
  { slug: 'liberty-finance', displayName: '自由財經', kind: 'rss', tier: 1, config: { feedUrl: 'https://news.ltn.com.tw/rss/business.xml' } },
  // 直連 feed 2020 後已停（feeds.reuters.com 現在連 DNS 都不解析），改走 Google News
  // proxy，與下面的 reuters-world 同一種做法。
  { slug: 'reuters-biz', displayName: 'Reuters Business (Google News proxy)', kind: 'rss', tier: 1, config: { feedUrl: 'https://news.google.com/rss/search?q=site:reuters.com+business&hl=en' } },
  // 原走 Google News 代理，citation 落在 news.google.com 不透明轉址、讀者點不到原文，
  // 且 description 只有錨點 HTML（enrich 出來的摘要是憑標題編的）。官方 feed 有 1-2 句真摘要。
  // 文章頁本身 403（付費牆），但網址仍是合法 citation——讀者看得到出處、知道需訂閱。
  { slug: 'bloomberg-markets', displayName: 'Bloomberg Markets', kind: 'rss', tier: 1, config: { feedUrl: 'https://www.bloomberg.com/feeds/markets/news.rss' } },
  { slug: 'wsj-markets', displayName: 'WSJ Markets (Google News proxy)', kind: 'rss', tier: 1, config: { feedUrl: 'https://news.google.com/rss/search?q=site:wsj.com+markets&hl=en' } },
  { slug: 'cnbc-markets', displayName: 'CNBC Markets', kind: 'rss', tier: 1, config: { feedUrl: 'https://www.cnbc.com/id/15839135/device/rss/rss.html' } },

  // Tier 2 · html-selector (5 家)
  { slug: 'twse-mops-news', displayName: '公開資訊觀測站重大訊息', kind: 'html-selector', tier: 2, config: {
    listingUrl: 'https://mops.twse.com.tw/mops/web/t146sb05',
    itemSelector: 'table.hasBorder tr.even, table.hasBorder tr.odd',
    titleSelector: 'td:nth-child(4)',
    linkSelector: 'a',
    dateSelector: 'td:nth-child(2)',
    // 明寫 null：這個來源零產出（見下面的 ACCEPTED_ZERO_OUTPUT_SLUGS），卡在沒有
    // GET 可達的單則訊息頁，所以**沒有正文頁可抓**、也沒有可驗證的 selector 好填。
    // 等 URL 那件事有解時，這一格要跟著一起決定。
    bodySelector: null,
  } },
  // ★ 2026-08-22 改走 TWSE OpenAPI。原本是 html-selector 刮
  //   twse.com.tw/announcement/notice，但那個 URL 早就不回 HTML 而是 JSON，而且語意也不對
  //   ——它是「當日公布注意有價證券」，不是證交所公告。所以這個來源從上線起零產出。
  //   新端點實測 538 筆、欄位 Title/Url/Date，Url 是真的可點的 content.html 連結。
  //   ★ 來源表原本寫「TWSE openapi 無一般公告端點」，那句是錯的、已一併更正。
  { slug: 'twse-announcements', displayName: '台灣證交所公告', kind: 'official-feed', tier: 2, config: {
    feedUrl: 'https://openapi.twse.com.tw/v1/news/newsList',
    format: 'twse-news-json',
  } },
  // ★ 2026-08-22 修正 selector：原本寫 'ul.newslist > li'，但 class 掛在 div 上——DOM 要
  //   到 div.newslist 底下才有 ul、ul 底下才是 li，所以 cheerio 命中 0，這個來源從上線起
  //   一篇都沒抓到過。下面用的是後代選擇器（對這一頁與 'div.newslist > ul > li' 等價）。
  //   修正後用同一支 fetchHtmlSelector 實測 15 筆、15 個唯一 news_view.jsp 連結、
  //   publishedAt 全部解析成功；本機與 prod api 容器打 listingUrl 都是 200。
  { slug: 'fsc-news', displayName: '金管會新聞稿', kind: 'html-selector', tier: 2, config: {
    listingUrl: 'https://www.fsc.gov.tw/ch/home.jsp?id=96&parentpath=0,2',
    itemSelector: 'div.newslist ul > li',
    titleSelector: 'span.title a',
    linkSelector: 'a',
    dateSelector: 'span.date',
    // 文章頁（news_view.jsp）是普通 HTML，正文整塊在 div.maincontent 裡。2026-08-23
    // 實測經 extractBody 正規化後 677 字元、含標題/日期/內文/聯絡單位，不含頁首選單
    // 與頁尾（釘子在 apps/server/src/corpus/sources/fsc-selector.test.ts，fixture 是
    // 整頁原樣）。★ 677 是走實際程式碼路徑量的；把換行也壓平會得到 672——量法不同
    // 就是不同的數字，引用時別混用。
    bodySelector: 'div.maincontent',
  } },
  // 原 html-selector 的 itemSelector 'ul.list > li' 已過期（實測 class="list" 命中 0）、從未產出過。
  // 央行本來就有官方 RSS，改走 official-feed。注意這個 feed 深度是 500 則、回溯到 2024-11，
  // 首次 refresh 會一次 enrich 約 500 篇（之後靠 (source_id, url_hash) 去重不再重跑）。
  { slug: 'cbc-press', displayName: '中央銀行新聞稿', kind: 'official-feed', tier: 2, config: {
    feedUrl: 'https://www.cbc.gov.tw/tw/rss-302-1.xml',
    format: 'rss',
  } },
  // 原 html-selector 去刮 fomccalendars.htm、從未產出過；Fed 本來就有官方 RSS。
  // ★ 這個 feed 的 <description> 15/15 完全等於 <title>（2026-08-21 實測），等於 title-only 來源——
  //   enrich 會拿標題編摘要。決定降級組成員時要把它算進去。
  { slug: 'fomc-statements', displayName: 'Fed FOMC statements', kind: 'official-feed', tier: 2, config: {
    feedUrl: 'https://www.federalreserve.gov/feeds/press_monetary.xml',
    format: 'rss',
  } },

  // ────────────────────────────────────────────
  // 跨域 corpus 擴充（15 家）
  // reachability dry-run 結論：7 OK / 6 FALLBACK / 1 DEAD（udn-cross-strait 改 udn-main）
  // ────────────────────────────────────────────

  // #1 海外地緣 / 政治
  { slug: 'reuters-world', displayName: 'Reuters World (Google News proxy)', kind: 'rss', tier: 1, config: { feedUrl: 'https://news.google.com/rss/search?q=site:reuters.com+world&hl=en' } },
  { slug: 'bbc-world', displayName: 'BBC World', kind: 'rss', tier: 1, config: { feedUrl: 'https://feeds.bbci.co.uk/news/world/rss.xml' } },
  // 同 bloomberg-markets 的理由改直連。官方 feed 的 description 是完整段落（實測首則 782 字元）。
  // 另有 /presidential-actions/feed/（行政命令、備忘錄）30 則，與本 feed **部分重疊**：
  // 2026-08-21 比對兩支的 <link>，交集 8/30，且本 feed 裡本來就有 8 則 /presidential-actions/
  // 路徑的文章。另立一個 source 的淨新增只有 22 則，是否值得未決。
  { slug: 'whitehouse-statements', displayName: 'White House 新聞稿', kind: 'rss', tier: 1, config: { feedUrl: 'https://www.whitehouse.gov/news/feed/' } },

  // #3 台灣兩岸 / 政治
  { slug: 'cna-politics', displayName: '中央社政治', kind: 'rss', tier: 1, config: { feedUrl: 'https://feeds.feedburner.com/rsscna/politics' } },
  // 舊路徑的 RSS 產生器回空殼（200、20 items，但 title/link/description 全空、pubDate=1970-01-01），
  // 換三個分類 id 皆同、與分類無關。/news/rssfeed/ 需帶尾斜線。
  // 2026-08-22 停用，理由同 udn-money。
  { slug: 'udn-main', displayName: '聯合新聞網主分類（兩岸 + 國際 + 政治混流）', kind: 'rss', tier: 1, enabled: false, config: { feedUrl: 'https://udn.com/news/rssfeed/' } },
  { slug: 'liberty-international', displayName: '自由時報國際', kind: 'rss', tier: 1, config: { feedUrl: 'https://news.ltn.com.tw/rss/world.xml' } },

  // #4 台灣政策 / 監管（補行政院；MOPS / TWSE / FSC / CBC 已有）
  { slug: 'ey-press', displayName: '行政院新聞稿 RSS', kind: 'rss', tier: 1, config: { feedUrl: 'https://www.ey.gov.tw/RSS_Content.aspx?ModuleType=3' } },

  // #5 戰爭 / 衝突
  { slug: 'aljazeera', displayName: 'Al Jazeera English', kind: 'rss', tier: 1, config: { feedUrl: 'https://www.aljazeera.com/xml/rss/all.xml' } },
  { slug: 'isw', displayName: 'Institute for the Study of War (Google News proxy)', kind: 'rss', tier: 1, config: { feedUrl: 'https://news.google.com/rss/search?q=site:understandingwar.org&hl=en' } },
  { slug: 'scmp-world', displayName: 'SCMP World', kind: 'rss', tier: 1, config: { feedUrl: 'https://www.scmp.com/rss/91/feed' } },

  // #6 智庫 / 政策研究
  { slug: 'csis', displayName: 'CSIS (Google News proxy)', kind: 'rss', tier: 1, config: { feedUrl: 'https://news.google.com/rss/search?q=site:csis.org&hl=en' } },
  { slug: 'brookings', displayName: 'Brookings (Google News proxy)', kind: 'rss', tier: 1, config: { feedUrl: 'https://news.google.com/rss/search?q=site:brookings.edu&hl=en' } },

  // #7 能源 / 大宗商品
  // 注意：EIA feed 為 ISO-8859-1 encoding。預設 RSS parser 應 cover；若 spot-check 發現 mojibake 再回來加 encoding field。
  { slug: 'eia', displayName: 'U.S. EIA Today in Energy', kind: 'rss', tier: 1, config: { feedUrl: 'https://www.eia.gov/rss/todayinenergy.xml' } },
  { slug: 'iea', displayName: 'International Energy Agency (Google News proxy)', kind: 'rss', tier: 1, config: { feedUrl: 'https://news.google.com/rss/search?q=site:iea.org&hl=en' } },
  { slug: 'oilprice', displayName: 'OilPrice.com', kind: 'rss', tier: 1, config: { feedUrl: 'https://oilprice.com/rss/main' } },
] as const

/**
 * 這個來源是不是 Google News 代理——也就是它抓回來的文章 url 會是不透明轉址。
 *
 * 判的是**來源定義自己的 feedUrl**，不是文章的 url host：
 * 來源歸屬不能靠文章 url 的 host（9 個代理共用 news.google.com、按 host 分類會把半個語料庫
 * 歸零）講的是歸屬，這裡講的是這個來源的取得方式。好處是自我修正——把某個來源換成直連
 * feed，它就自動變回可引用，不必記得回來改名單（bloomberg-markets 與
 * whitehouse-statements 正是如此）。
 *
 * 這與規則一（文章層級的「body 沒超出標題就不 enrich」）是兩件事，別合併——但理由不是
 * 「fomc 該擋 enrich、不該擋引用」，那句話**在現行管線上不成立**（不 enrich 的文章
 * entities／topic_tags 為空，retriever 的 jsonb containment 永不命中，它同樣引用不到；
 * 2026-08-21 更正，詳見 packages/shared/src/enrichable.ts 檔頭）。
 *
 * 真正的理由是兩者問的問題與作用對象不同：規則一決定「要不要為這篇文章花 LLM」，
 * 這一支決定「一篇**已經有摘要**的文章能不能進 prompt」——它真正的作用對象是既有那批
 * 已 enrich 的代理文章，新文章被規則一擋下之後根本不會有摘要。
 */
export function isAggregatorProxySeed(seed: ExternalSourceSeed): boolean {
  const config = seed.config as { feedUrl?: unknown }
  if (typeof config.feedUrl !== 'string')
    return false
  try {
    return new URL(config.feedUrl).host === 'news.google.com'
  }
  catch {
    return false
  }
}

/**
 * 已知零產出、**明示接受不告警**的來源。
 *
 * 為什麼要有這份清單：`summarizeSourceSilence` 判定的 never 類原本一律只註記不告警（否則第一天就
 * 37% firing rate）。但那讓「換過 feed、卻仍然抓不到」變成永遠不會有人知道的狀態——
 * 2026-08-21 的 `udn-money`／`udn-main` 就是這樣：換了新 feed、本機驗到 20／93 則，
 * 部署環境打同一個 feed 卻拿不到，換完仍是 total=0，於是安靜地留在 never 裡。
 *
 * ★ **改了某個來源的 feed，就要把它從這份清單拿掉。** 清單刻意放在來源設定旁邊，
 * 就是為了讓改 feed 的那個 diff 同時看得到它。拿掉之後若仍零產出，就會落回 never 類、
 * 不再套用這份清單的例外，讓外部監控據此判斷。
 *
 * 這裡的每一筆都要寫得出「為什麼現在不修」，寫不出來的就不該進來。
 */
export const ACCEPTED_ZERO_OUTPUT_SLUGS: readonly string[] = Object.freeze([
  // ★ 2026-08-22：twse-announcements 已改走 TWSE OpenAPI、離開這份清單。
  //   twse-mops-news 留著，卡的不是抓不到資料而是**沒有 citation URL**：替代端點
  //   opendata/t187ap04_L 有 135 筆真資料，但整份回應**沒有任何 URL 欄位**，而
  //   FetchedEntry.url 必填、external_articles 的 unique 是 (source_id, url_hash)。
  //   實測 MOPS 也沒有 GET 可達的單則訊息頁（帶 co_id 的 t05st01 回的是空殼查詢頁、
  //   真資料要 POST），硬構造一個 per-company URL 會讓同一家公司的多則訊息互相擠掉。
  //   題材（上市公司法定重大訊息）沒有替代來源覆蓋，所以不停用，留在這裡等 URL 有解。
  'twse-mops-news',
  // ★ 2026-08-22 這一輪有三個離開這份清單，處置各不相同：
  //   - commercial-times／moneydj：外部 feed 真的沒了，改成停用。
  //   - fsc-news：不是外部問題，是 selector 錯一層、已修好。
  //   規則同一條——**不再屬於「已知零產出且不打算現在修」的來源就要離開這份清單**，
  //   留著會變成沒人看得懂的死條目。
  // ★ udn-money／udn-main 曾在這裡，2026-08-22 隨停用一起移除：
  //   getSourceActivity 只看 enabled=true 的來源，停用之後它們根本不會進入靜默判定，
  //   留在這份清單裡只是死條目。停用來源不該出現在這裡——有測試釘住這條。
])

/**
 * 不可引用的來源 slug。retriever 用它把這些來源整批排除在檢索與 citation 之外
 * （`analyst-tier1` 的 allowedUrls 來自 retrieve 結果）。
 *
 * 這也是處理**既有** 9,061 篇假摘要的可逆手段：不刪任何資料，只是不再讓它們進 prompt。
 */
export const AGGREGATOR_PROXY_SLUGS: readonly string[]
  = EXTERNAL_SOURCES_SEED.filter(isAggregatorProxySeed).map(s => s.slug)

/**
 * 已知「窗內有列、但一篇都不會被 enrich」且**明示接受不告警**的來源。
 *
 * 為什麼需要這一份：`/api/ops/publication-status` 現在除了「有沒有列」也回「窗內有沒有
 * 可檢索的內容」。沒有這份清單，那條告警上線第一天就會對著 Google News 代理群開火——
 * 而它們不被 enrich 是 `hasBodyBeyondTitle`（規則一）**刻意**擋下來的：那些 feed 的
 * description 是錨點 markup，剝完剛好等於標題，餵進 LLM 只會產出憑標題編的假摘要。
 * 它們也已經被 `AGGREGATOR_PROXY_SLUGS` 排除在檢索與 citation 之外，所以「不可檢索」
 * 對它們不是新聞。
 *
 * 2026-08-23 拿 prod 近 7 天的真資料就地重跑規則一量過：22 個有產出的來源裡，
 * `wouldEnrich = 0` 的正好是這 7 個代理加上 `fsc-news`（後者是真缺陷，正在修）。
 * 也就是加上這份清單之後首日 firing 是 1/26，不加是 8/26。
 *
 * ★ **不要為了讓告警閉嘴就往這裡加 slug。** 一個非代理來源掉到零 enrich，代表它的新文章
 * 從此進不了檢索池——那要修的是正文抓取（見 html-selector 的 `bodySelector`），不是告警。
 * `fomc-statements` 刻意**不**列在這裡：它現在 total=0 所以根本不會觸發，但它一旦開始
 * 產出 title-only 的文章，那就是要修的事。
 *
 * ★ 沒有訂「最少幾篇才判定」的門檻：同一次量測顯示分佈是雙峰的（0% 或 ~99%，中間沒有
 * 來源）。若日後證實低量來源會偶發誤報，要補的是最少篇數，不是把這條檢查拿掉。
 */
export const ACCEPTED_ZERO_ENRICHMENT_SLUGS: readonly string[] = Object.freeze([
  ...AGGREGATOR_PROXY_SLUGS,
])

/**
 * 參數只為了測試而存在：預設就是整份 EXTERNAL_SOURCES_SEED，CLI 與 prod 都不會傳。
 * 有它才能用合成來源驗 upsert 的 set 子句，而不必把 30 筆真來源寫進測試用的 DB。
 */
export async function seedExternalSources(
  sources: readonly ExternalSourceSeed[] = EXTERNAL_SOURCES_SEED,
): Promise<{ upserted: number }> {
  const db = getDb()
  let upserted = 0
  for (const src of sources) {
    ExternalSourceSeedSchema.parse(src)
    await db.insert(externalSources).values({
      slug: src.slug,
      displayName: src.displayName,
      kind: src.kind,
      tier: src.tier,
      config: src.config,
      enabled: src.enabled ?? true,
    }).onConflictDoUpdate({
      target: externalSources.slug,
      // enabled 納入 set：停用一個來源要能靠改這個檔完成，否則 seed 與 DB 會分岔，
      // 而「停用」就變成一個只存在於某次手動 SQL 的決定、下一個人看檔案看不出來。
      // 2026-08-22 實測 prod 零個 enabled=false 的來源，所以接管不會覆蓋任何手動決定。
      //
      // ★ 2026-09-10 起這個前提不再成立：這個檔案下方的 CLI entry 現在會把
      // `RESOLVED_EXTERNAL_SOURCES_GATE` 算出的 `resolvedEnabled` 傳進來，而預設
      // （沒開 `SEED_THIRD_PARTY_SOURCES`）就是把商業媒體來源的 `enabled` 算成 false
      // ——也就是「接管會覆蓋手動決定」這件事，現在正是這次改動本身要做的事。
      // 為此加了一層獨立於這個函式之外的保護：CLI entry 在呼叫 `seedExternalSources`
      // 之前，會先查 DB 裡有沒有「這次會被 gate 擋下、但目前其實是 enabled = true」
      // 的第三方來源；有的話直接中止（`shouldBlockDowngrade`），要求使用者用
      // `SEED_THIRD_PARTY_SOURCES=true` 或 `SEED_ALLOW_DOWNGRADE=true` 明示選擇，
      // 不會在沒人看到的情況下把作者手動啟用過的來源悄悄關掉。這個函式本身依然是
      // 忠實 upsert、不做任何 gate 判斷——保護加在呼叫它之前。
      set: { displayName: sql`EXCLUDED.display_name`, kind: sql`EXCLUDED.kind`, tier: sql`EXCLUDED.tier`, config: sql`EXCLUDED.config`, enabled: sql`EXCLUDED.enabled` },
    })
    upserted++
  }
  return { upserted }
}

// `SEED_THIRD_PARTY_SOURCES` 在 module 頂層讀一次（`seed:external-sources` 的 tsx CLI
// 用 `--env-file-if-exists` 在 import 前就把 .env 載好，所以這裡讀到的跟原本在 CLI
// entry 裡讀的是同一個值，行為不變）。刻意搬到頂層：`RESOLVED_EXTERNAL_SOURCES_GATE`
// 才能在**import 當下**就算好，讓測試不必連 DB、不必真的執行 CLI 就能斷言
// 「optIn 沒開時，最終真的只有幾筆會被啟用」。
const optIn = thirdPartySourcesEnabled()

/**
 * `EXTERNAL_SOURCES_SEED` 套用第三方來源 gate 後的結果——CLI entry 與測試共用同一份
 * 計算，不是各自重算一次（重算兩次遲早會分岔）。
 */
export const RESOLVED_EXTERNAL_SOURCES_GATE = applySeedGate(
  EXTERNAL_SOURCES_SEED,
  optIn,
  s => ({ slug: s.slug, urls: collectHttpUrls(s.config), declared: s.enabled ?? true }),
)

// CLI entry
if (import.meta.url === `file://${process.argv[1]}`) {
  const { gated, withheldSlugs } = RESOLVED_EXTERNAL_SOURCES_GATE
  if (!optIn && withheldSlugs.length > 0) {
    console.warn(
      `[seed:external-sources] ★ 第三方來源預設停用：${withheldSlugs.length} 筆商業媒體來源這次不會被啟用`
      + `（${withheldSlugs.join(', ')}）。`,
    )
    console.warn(
      '[seed:external-sources] 要啟用它們，請設定環境變數 SEED_THIRD_PARTY_SOURCES=true 再重跑 seed:external-sources。'
      + '這些來源是第三方媒體，開啟前請自行確認各站 ToS 與 robots.txt。',
    )
  }
  const finalSeeds = gated.map(({ entry, resolvedEnabled }) => ({ ...entry, enabled: resolvedEnabled }))
  // 拒絕靜默降級：在寫任何東西進 external_sources 之前，先查 DB 裡有幾筆會被這次
  // gate 擋下的來源目前其實是 enabled = true——那代表作者手動啟用過，這次跑會把
  // 它們悄悄關掉。withheldSlugs 為空就不用查（省一次 round-trip，也避免 IN () 空陣列）。
  const allowDowngrade = downgradeAllowed();
  (async () => {
    let enabledThirdParty: string[] = []
    if (withheldSlugs.length > 0) {
      const db = getDb()
      const rows = await db.select({ slug: externalSources.slug })
        .from(externalSources)
        .where(and(inArray(externalSources.slug, withheldSlugs), eq(externalSources.enabled, true)))
      enabledThirdParty = rows.map(r => r.slug)
    }
    if (shouldBlockDowngrade(enabledThirdParty, optIn, allowDowngrade)) {
      console.error(
        `[seed:external-sources] ✗ 中止：這次會把 ${enabledThirdParty.length} 筆目前啟用中的第三方來源`
        + `翻成停用（${enabledThirdParty.join(', ')}）。`,
      )
      console.error(
        '[seed:external-sources] 這些來源目前是 enabled = true，代表先前曾經明確啟用過；直接跑下去會'
        + '在沒有任何提示下讓它們停用，隔天日報 Cascade 檢索的素材會明顯變少。',
      )
      console.error(
        '[seed:external-sources] 請二選一：設定 SEED_THIRD_PARTY_SOURCES=true 繼續抓第三方來源；'
        + '或設定 SEED_ALLOW_DOWNGRADE=true 明確表示你確認要停用它們。',
      )
      process.exit(1)
    }
    return seedExternalSources(finalSeeds)
  })().then((r) => {
    // eslint-disable-next-line no-console -- deliberate CLI stdout output; result is piped/read by callers
    console.log(JSON.stringify(r))
    process.exit(0)
  }).catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
