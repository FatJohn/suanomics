import type { SQL } from 'drizzle-orm'
import type { RetrievedArticle } from './types.js'
import { getDb } from '@suanomics/db/client'
import { externalArticles, externalSources } from '@suanomics/db/schema'
import { AGGREGATOR_PROXY_SLUGS } from '@suanomics/db/seed-external-sources'
import { and, desc, eq, gte, lte, notInArray, or, sql } from 'drizzle-orm'

export interface RetrieveQuery {
  entities?: string[]
  topics?: string[]
  days: number
  limit?: number
  /**
   * 報告日（`YYYY-MM-DD`）。**必填、沒有預設**——之前這支只有下界
   * （`Date.now() - days`），補產舊報告時會撈到報告日之後才抓進來的文章，
   * citation 於是引用「當時還不存在」的來源，而且不影響 job 成敗。
   * 必填是刻意的：給預設等於把同一個陷阱換個地方留著，而三個呼叫端上游全都
   * 拿得到報告日（`orchestrator` 的 `p.date`／`p.briefDate`、analyze job 的
   * `payload.reportDate`），threading 是機械性的。
   */
  reportDate: string
}

export async function retrieveArticles(q: RetrieveQuery): Promise<RetrievedArticle[]> {
  const hasEntities = (q.entities?.length ?? 0) > 0
  const hasTopics = (q.topics?.length ?? 0) > 0

  // 兩者都空 → 直接回空，避免全表掃
  if (!hasEntities && !hasTopics)
    return []

  const limit = q.limit ?? 5
  // ★ 界線是**台北日界**，與序列快照、官方公告、行事曆同一條紀律（`market-data/context.ts`
  //   的 `loadOfficial`，`context.ts:245-249`）。台灣沒有日光節約，+08:00 是常數、可以直接寫進字串。
  //   用 UTC 日界會把台北當天稍晚抓到的文章算成隔天、當場放行報告日之後的素材。
  const until = new Date(`${q.reportDate}T23:59:59.999+08:00`)
  const since = new Date(until.getTime() - q.days * 86_400_000)

  const conds: SQL[] = []

  if (hasEntities) {
    // entities @> '[{"name":"X"}]'::jsonb — 命中 GIN index (jsonb_path_ops)
    // 每個 entity 一個 @>、再 OR 起來、實現 ANY-match 語意。
    // 之前用單一 `[{name:A},{name:B}]` 會被 jsonb 解成「兩者都得 tag」、alias 展開後永遠 0 命中。
    // eslint-disable-next-line ts/no-non-null-assertion -- hasEntities guard above guarantees entities is defined
    const entityClauses = q.entities!.map(e =>
      sql`${externalArticles.entities} @> ${JSON.stringify([{ name: e }])}::jsonb`,
    )
    // eslint-disable-next-line ts/no-non-null-assertion -- entityClauses[0] exists when length===1; or(...) returns non-null for non-empty array
    const entityOr = entityClauses.length === 1 ? entityClauses[0]! : or(...entityClauses)!
    conds.push(entityOr)
  }

  if (hasTopics) {
    // topic_tags @> '["半導體"]'::jsonb — 命中 GIN index
    // 每個 topic 一個 @>、再 OR 起來，與上面的 entity 路徑同語意。
    // 單一 `["a","b"]` 會被 jsonb 解成「同一篇要同時帶齊 a 與 b」——decomposer 一個
    // hypothesis 常帶多個 topic，只要其中一個在 corpus 裡不存在，整條查詢就歸零。
    // eslint-disable-next-line ts/no-non-null-assertion -- hasTopics guard above guarantees topics is defined
    const topicClauses = q.topics!.map(t =>
      sql`${externalArticles.topicTags} @> ${JSON.stringify([t])}::jsonb`,
    )
    // eslint-disable-next-line ts/no-non-null-assertion -- topicClauses[0] exists when length===1; or(...) returns non-null for non-empty array
    const topicOr = topicClauses.length === 1 ? topicClauses[0]! : or(...topicClauses)!
    conds.push(topicOr)
  }

  // Google News 代理來源整批排除。它們的 url 是不透明轉址（讀者點不到
  // 原文），而 content_summary 是模型看錨點 markup 編出來的——進了 prompt 就是拿虛構
  // 摘要當依據。analyst-tier1 的 allowedUrls 直接來自這裡的回傳，所以擋在這一層就夠。
  //
  // 走 source_id join、不解析文章 url 的 host：9 個代理共用
  // news.google.com、按 host 分類會把半個語料庫歸零。
  //
  // 這也是處理**既有**假摘要的可逆手段——不刪任何資料，只是不再讓它們進 prompt。
  const rows = await getDb()
    .select({
      id: externalArticles.id,
      url: externalArticles.url,
      title: externalArticles.title,
      contentSummary: externalArticles.contentSummary,
      entities: externalArticles.entities,
      topicTags: externalArticles.topicTags,
      fetchedAt: externalArticles.fetchedAt,
    })
    .from(externalArticles)
    .innerJoin(externalSources, eq(externalSources.id, externalArticles.sourceId))
    .where(and(
      or(...conds),
      gte(externalArticles.fetchedAt, since),
      lte(externalArticles.fetchedAt, until),
      ...(AGGREGATOR_PROXY_SLUGS.length > 0 ? [notInArray(externalSources.slug, [...AGGREGATOR_PROXY_SLUGS])] : []),
      // 來源層級擋不到的那一批：bloomberg-markets / whitehouse-statements 改成
      // 直連之後它們就不在代理清單裡，但**舊文章**的 url 仍是 google 轉址（2026-08-21
      // prod 實測 2,946 篇）。這一條判的是「這個 url 讀者點不點得到」——是 url 自己的
      // 性質，不是拿 host 做來源歸屬（兩者不同）。
      sql`${externalArticles.url} !~ '^https?://news[.]google[.]com/'`,
    ))
    .orderBy(desc(externalArticles.fetchedAt))
    .limit(limit)

  return rows.map(row => ({
    id: row.id,
    url: row.url,
    title: row.title,
    contentSummary: row.contentSummary,
    entities: (row.entities as unknown[]) ?? [],
    topicTags: (row.topicTags as string[]) ?? [],
    fetchedAt: row.fetchedAt.toISOString(),
  }))
}
