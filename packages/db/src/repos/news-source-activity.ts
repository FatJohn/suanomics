import { getDb } from '@suanomics/db/client'
import { newsItems, newsSources } from '@suanomics/db/schema'
import { hasBodyBeyondTitle } from '@suanomics/shared'
import { and, eq, gte, sql } from 'drizzle-orm'

/** 一個啟用中日報來源的產出量，餵給 `@suanomics/shared` 的 `summarizeSourceSilence`。 */
export interface NewsSourceActivityRow {
  slug: string
  articlesInWindow: number
  /**
   * 判定窗內**真的能用**的則數＝`content_text` 有超出標題的資訊。
   *
   * ★ **刻意不是「非空」。** Google News 代理的 `content_text` 是錨點 markup
   * （`<a href="…">標題</a>` 加發行商），非空、中位數三四百字元，但剝掉標記之後
   * 剛好等於標題本身——資訊量為零。用非空判的話 2026-08-23 的 prod 現況是 18/18 全綠，
   * 而實際上當時 13 個來源一則都沒有超出標題（2026-08-28 換掉三個直連 feed 後是
   * 10——這個數字每次換 feed 都會變，別當常數引用）。判準用的是與 corpus 那條 pipeline
   * 完全同一個函式（`hasBodyBeyondTitle`，2026-08-23 為此搬進 @suanomics/shared），
   * 不是另寫一份 SQL——兩份實作遲早分岔，這個 repo 已經在 enrichment 快取上踩過。
   */
  usableInWindow: number
  totalArticles: number
  /** 來源列的 `created_at`（ISO）。給剛加進來、還沒輪到 refresh 的來源一個寬限期用。 */
  createdAt: string
}

/**
 * 各啟用日報來源在判定窗內／有史以來的則數，以及其中有多少是能用的。
 *
 * 與 corpus 的 `getSourceActivity` 是同一個形狀、餵同一支 `summarizeSourceSilence`，
 * 但兩張表、兩組來源設定，所以是兩支函式而不是一支加參數。
 *
 * **可用數在 JS 算、不在 SQL 算**：判準是 `hasBodyBeyondTitle`，它要剝標記與 HTML entity、
 * 正規化標點再比對，用 `regexp_replace` 疊出來的版本遲早與 JS 那份分岔——而分岔的方向是
 * 靜默的（SQL 版說健康、實際不可用）。代價是窗內的列要撈回來：7 天約 2,500 列、
 * 只取三個欄位，而這個端點預期呼叫頻率低：排程觸發與外部監控一天合計只打幾次的量級。
 *
 * **窗判定一定要用 `gte()`、不能在 `sql` template 裡裸寫 `${windowStart}`**——理由與
 * `articles-repo.ts` 的 `getSourceActivity` 完全相同（drizzle 換掉 postgres-js 的日期
 * serializer，裸內插的 Date 會炸在 driver 的 bind）。
 */
export async function getNewsSourceActivity(windowStart: Date): Promise<NewsSourceActivityRow[]> {
  const db = getDb()
  // ★ 窗內則數**不在這裡算**，改由下面那份 windowRows 數。兩個 query 不在同一個快照裡，
  // refresh 若剛好插在中間，窗內則數與可用則數會來自不同時間點——明細印出 `170/160`
  // 這種讀不懂的數字，反過來還可能讓某個來源被歸成 silent 而誤發告警。
  // 同一份結果集數兩個數字，這個比例就恆定義得出來。
  const totals = await db
    .select({
      slug: newsSources.slug,
      totalArticles: sql<number>`count(${newsItems.id})`.mapWith(Number),
      createdAt: newsSources.createdAt,
    })
    .from(newsSources)
    .leftJoin(newsItems, eq(newsItems.sourceId, newsSources.id))
    .where(eq(newsSources.isActive, true))
    .groupBy(newsSources.slug, newsSources.createdAt)

  const windowRows = await db
    .select({ slug: newsSources.slug, title: newsItems.title, contentText: newsItems.contentText })
    .from(newsItems)
    .innerJoin(newsSources, eq(newsItems.sourceId, newsSources.id))
    .where(and(eq(newsSources.isActive, true), gte(newsItems.fetchedAt, windowStart)))

  const inWindowBySlug = new Map<string, number>()
  const usableBySlug = new Map<string, number>()
  for (const r of windowRows) {
    inWindowBySlug.set(r.slug, (inWindowBySlug.get(r.slug) ?? 0) + 1)
    if (hasBodyBeyondTitle(r.title, r.contentText))
      usableBySlug.set(r.slug, (usableBySlug.get(r.slug) ?? 0) + 1)
  }

  return totals.map(r => ({
    slug: r.slug,
    articlesInWindow: inWindowBySlug.get(r.slug) ?? 0,
    usableInWindow: usableBySlug.get(r.slug) ?? 0,
    totalArticles: r.totalArticles,
    createdAt: r.createdAt.toISOString(),
  }))
}
