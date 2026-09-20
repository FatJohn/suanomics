/**
 * 來源零產出偵測。
 *
 * 動機：2026-08-17 發現 30 個啟用來源裡有 10 個從未產出過任何文章，其中包含五個官方來源
 * 與五個台灣財經媒體 RSS——而且沒有任何機制會說。是人工撈 DB 找別的東西時撞到的。
 *
 * **為什麼 never 與 silent 一定要分開**：兩者的處置不同，混成一類會讓告警第一天就 37%
 * firing rate（11/30），稀釋掉「當天報告沒產出」那種真正致命的告警。
 *
 * - `never`：`totalArticles === 0`。既有的設定破損。**列出、不告警。**
 * - `silent`：曾經產出、窗內掛零。**這才是回歸訊號，告警。**
 *
 * **2026-08-21 補第三類 `neverUnexpected`**：把 `udn-money`／`udn-main` 換了新 feed，
 * 本機驗到 20／93 則，但 prod 容器打同一個 feed 回 403。它們換完之後仍是
 * `total = 0`，因此會**永遠**待在只註記不告警的 never 類——而換 feed 是一次明確的介入，
 * 之後仍零產出就是回歸訊號，不是「已知破損」。
 *
 * ★ 那兩個來源已於 2026-08-22 停用（站方對部署環境的自動化請求回 403）。`getSourceActivity` 只看 `enabled = true`，所以它們現在根本不進
 *   這個判定——**但 `neverUnexpected` 這一類要留著**，它治的是「明確介入之後仍零產出」
 *   這個形狀，不是那兩個來源本身。
 *
 * 分法是**明示接受**而不是時間啟發式：已知破損且不打算現在修的來源列進
 * `ACCEPTED_ZERO_OUTPUT_SLUGS`（`@suanomics/db` 的 seed 檔，就放在來源設定旁邊），其餘落進
 * never 的一律告警。**改了某個來源的 feed 就要把它從那份清單拿掉**——這是這條告警缺的
 * forcing function，也是為什麼清單放在 seed 旁邊：改 feed 的那個 diff 會同時看到它。
 */

export type SourceSilenceState = 'ok' | 'silent' | 'never'

export interface SourceActivity {
  slug: string
  /** 判定窗內的文章數。窗定義見 `SOURCE_SILENCE_WINDOW_DAYS`。 */
  articlesInWindow: number
  /** 有史以來的文章數。用來分辨 never 與 silent。 */
  totalArticles: number
  /**
   * 來源列的 `created_at`（ISO）。只用來給剛加進來、還沒輪到 refresh 的來源一個寬限期。
   *
   * ★ 名字就叫 createdAt 而不是 enabledSince，因為它**只**是建立時間：停用後再啟用
   * 不會更新它，seed 的 upsert 也不動它（`set` 自 2026-08-22 起是 display_name/kind/tier/
   * config/enabled 五欄，**仍不含 created_at**，所以這段的結論不變）。
   * 所以「舊來源換了新 feed」這個情境沒有寬限期——那是刻意的，換 feed 之後就該產出。
   *
   * ★ 已知盲點：重建 DB 或刪掉來源重加會**重置** created_at，於是全部來源靜音 7 天，
   * 而災難重建正是最需要這條告警的時候。目前接受這個風險（重建是有人在旁邊看的動作）。
   *
   * 省略＝視為已經存在夠久（會照常告警）。呼叫端一定拿得到這個值，省略只出現在
   * 只驗舊行為的測試裡；方向是安全的（寧可誤報也不要漏報）。
   */
  createdAt?: string
  /**
   * 判定窗內**真的能用**的列數。「能用」由呼叫端定義，因為兩條 pipeline 的判準不同：
   *
   * - corpus（`getSourceActivity`）：`content_summary` 非空。沒 enrich 的文章
   *   `entities`／`topic_tags` 都是 `[]`，而 retriever 兩條路徑都是 jsonb containment，
   *   空陣列永不命中。
   * - 日報（`getNewsSourceActivity`）：`content_text` 有超出標題的資訊
   *   （`hasBodyBeyondTitle`）。**這裡刻意不是「非空」**——Google News 代理的
   *   `content_text` 是錨點 markup，非空但資訊量為零，用非空判會對整批代理給假綠
   *   （2026-08-23 量到 13/18，2026-08-28 換掉三個直連 feed 後是 10；數字會變、判準不變）。
   *
   * 為什麼要單獨數這個：`articlesInWindow` 問的是「有沒有列」，而這兩條 pipeline 在乎的
   * 都是「有沒有**能用**的內容」。兩者 2026-08-22 第一次分岔，一次就分岔了兩個來源。
   *
   * 省略＝拿不到這個數字，此時**不判 zeroUsable**（與 `neverUnexpected` 同樣的保守
   * 方向：寧可不叫，也不要把 undefined 當成 0 亂叫）。
   */
  usableInWindow?: number
}

export interface SourceSilenceSummary {
  windowDays: number
  /** 曾經產出、窗內掛零——要告警。slug 升冪。 */
  silent: string[]
  /** 從未產出——只列出，不告警。含下面 neverUnexpected 的成員。slug 升冪。 */
  never: string[]
  /**
   * 從未產出、且**不在**接受清單裡、且已經存在超過寬限期——要告警。slug 升冪。
   * 沒傳 opts 時恆為空陣列（維持本模組原本的保守行為）。
   */
  neverUnexpected: string[]
  /**
   * 窗內**有列、卻一列都不能用**的來源——要告警。「能用」的定義見 `usableInWindow`。slug 升冪。
   *
   * 這一類與 silent／never 互斥：窗內零列的來源不會進來（那是那兩類的事）。
   * 沒傳 opts、或該來源沒有 `usableInWindow` 時恆不進。
   */
  zeroUsable: string[]
}

export interface SourceSilenceOptions {
  /** 已知零產出、明示接受不告警的 slug。來源見 `@suanomics/db` 的 `ACCEPTED_ZERO_OUTPUT_SLUGS`。 */
  acceptedZeroOutput: readonly string[]
  /**
   * 已知「有列但不能用」且明示接受的 slug。corpus 端見 `@suanomics/db` 的
   * `ACCEPTED_ZERO_ENRICHMENT_SLUGS`、日報端見 `ACCEPTED_ZERO_USABLE_NEWS_SLUGS`。
   * 省略＝一律不判 zeroUsable。
   */
  acceptedZeroUsable?: readonly string[]
  /** 判定基準時間；測試注入用。 */
  now?: Date
}

/**
 * 判定窗：**含當日往回數 7 個日曆日**（`[D-6, D]`）。
 *
 * 7 是量出來的、不是推出來的。2026-08-17 對 prod 近 30 日量各來源的每日產出間隔：
 * 最大是 `cnbc-markets` 的 6 天，其次 `ey-press`／`iea`／`liberty-international`／`eia`
 * 各 4 天，其餘 15 個都是 2 天。7 是不誤報的最小整數。
 *
 * ★ 多數來源的平均間隔 2.0 **不是來源自己的節奏，是 corpus 每 2 天 refresh 一次**的節奏。
 * 所以若 refresh 改成每日，**要重新量**再調這個數字——直接照推會調錯。
 */
export const SOURCE_SILENCE_WINDOW_DAYS = 7

export function classifySourceSilence(a: SourceActivity): SourceSilenceState {
  // never 必須先判：totalArticles 為 0 時 articlesInWindow 必然也是 0，
  // 順序反過來的話所有 never 都會被歸成 silent、然後每天告警。
  if (a.totalArticles === 0)
    return 'never'
  if (a.articlesInWindow === 0)
    return 'silent'
  return 'ok'
}

/**
 * 寬限期沿用判定窗的 7 天，不另訂一個數字。
 *
 * 理由不是省事：corpus 每 2 天 refresh 一次，一個剛加進來的來源最多等 2 天才輪到，
 * 而 7 天已經是「連續多輪都沒東西」的量級——與 silent 的門檻同一個量級，讀的人不必
 * 記兩個數字。refresh 節奏若改，兩個一起重新量（見 SOURCE_SILENCE_WINDOW_DAYS 的註記）。
 */
function isWithinGrace(createdAt: string | undefined, now: Date): boolean {
  if (createdAt === undefined)
    return false
  const since = new Date(createdAt).getTime()
  if (Number.isNaN(since))
    return false
  return now.getTime() - since < SOURCE_SILENCE_WINDOW_DAYS * 86_400_000
}

export function summarizeSourceSilence(
  sources: readonly SourceActivity[],
  opts?: SourceSilenceOptions,
): SourceSilenceSummary {
  const silent: string[] = []
  const never: string[] = []
  const neverUnexpected: string[] = []
  const zeroUsable: string[] = []
  const accepted = new Set(opts?.acceptedZeroOutput ?? [])
  // undefined（含整個 opts 省略）與空陣列是不同的意思：前者是「沒開這條判定」，
  // 後者是「開了、但沒有任何來源被明示接受」。
  const acceptedNoEnrich = opts?.acceptedZeroUsable === undefined ? null : new Set(opts.acceptedZeroUsable)
  const now = opts?.now ?? new Date()
  for (const s of sources) {
    const state = classifySourceSilence(s)
    if (state === 'silent') {
      silent.push(s.slug)
    }
    else if (state === 'never') {
      never.push(s.slug)
      if (opts !== undefined && !accepted.has(s.slug) && !isWithinGrace(s.createdAt, now))
        neverUnexpected.push(s.slug)
    }
    // 只問窗內在產出的來源。零列的交給 silent／never，不重複叫。
    // 沒有寬限期：articlesInWindow > 0 代表它已經在產出了，不是「還沒輪到」。
    else if (acceptedNoEnrich !== null && s.usableInWindow === 0 && !acceptedNoEnrich.has(s.slug)) {
      zeroUsable.push(s.slug)
    }
  }
  // 排序是為了讓告警訊息可比對：順序浮動的話，兩天的輸出用肉眼看不出差異在哪。
  silent.sort()
  never.sort()
  neverUnexpected.sort()
  zeroUsable.sort()
  return { windowDays: SOURCE_SILENCE_WINDOW_DAYS, silent, never, neverUnexpected, zeroUsable }
}
