import { getDb } from '@suanomics/db/client'
import { externalArticles, externalSources } from '@suanomics/db/schema'
import { and, eq, gte, inArray, isNotNull, ne, sql } from 'drizzle-orm'
import { z } from 'zod'

// I3 fix: DB row jsonb 欄位的 zod schema，在讀取 boundary 驗證，替代裸型別 cast。
// confidence 在 DB 可能為 null/undefined（舊資料無此欄），預設 0 讓型別符合 EnrichmentSnapshot。
const EntitiesArraySchema = z.array(z.object({
  kind: z.string(),
  name: z.string(),
  confidence: z.number().min(0).max(1).default(0),
})).default([])

const TopicTagsArraySchema = z.array(z.string()).default([])

export interface InsertArticleInput {
  sourceId: string
  externalId: string | null
  url: string
  urlHash: string
  title: string
  publishedAt: Date | null
  rawExcerpt: string | null
  fullText: string | null
  contentHash: string | null
  contentSummary: string | null
  entities: Array<{ kind: string, name: string, confidence: number }>
  topicTags: string[]
  llmModel: string | null
  llmCostUsd: number | null
}

export interface EnrichmentSnapshot {
  contentSummary: string | null
  entities: Array<{ kind: string, name: string, confidence: number }>
  topicTags: string[]
}

export interface ArticlesRepo {
  findEnrichmentByContentHash: (contentHash: string) => Promise<EnrichmentSnapshot | null>
  insertArticle: (input: InsertArticleInput) => Promise<string>
  isDuplicateUrl: (sourceId: string, urlHash: string) => Promise<boolean>
}

interface FakeArticlesDb {
  query?: (sql: string, ...params: unknown[]) => Promise<unknown[]>
  insert?: (values: unknown) => Promise<Array<{ id: string }>>
}

function isFakeDb(v: unknown): v is FakeArticlesDb {
  return typeof v === 'object' && v !== null && ('query' in v || 'insert' in v)
}

export function createArticlesRepo(db?: FakeArticlesDb): ArticlesRepo {
  if (db && isFakeDb(db)) {
    return {
      findEnrichmentByContentHash: async (hash) => {
        if (!db.query)
          return null
        const rows = await db.query('SELECT content_summary, entities, topic_tags FROM external_articles WHERE content_hash = $1 AND content_summary IS NOT NULL AND content_summary <> \'\' LIMIT 1', hash)
        const first = rows[0] as EnrichmentSnapshot | undefined
        // 真 DB 那條靠 SQL 的 isNotNull 擋掉空摘要；這裡再擋一次，否則注入的 fake
        // 回什麼就是什麼，fake 與真 driver 的語意會分岔——這個 repo 踩過這個坑。
        return first?.contentSummary ? first : null
      },
      insertArticle: async (input) => {
        if (!db.insert)
          throw new Error('fake db missing insert')
        const res = await db.insert(input)
        return res[0]?.id ?? 'fake-id'
      },
      isDuplicateUrl: async () => false,
    }
  }

  return {
    findEnrichmentByContentHash: async (hash) => {
      const realDb = getDb()
      // 只認**有摘要**的列。沒有 isNotNull 這個條件時，一列「有 content_hash 但摘要是
      // NULL」的文章會被當成 cache hit，讓後面那篇真的該 enrich 的文章靜默標成 reused、
      // 永遠拿不到摘要。這種空列一直存在（enrich 失敗就會產生一列），2026-08-21
      // 之後大量增加——代理來源與 Fed 那類 title-only 全部刻意不 enrich。
      const rows = await realDb.select({
        contentSummary: externalArticles.contentSummary,
        entities: externalArticles.entities,
        topicTags: externalArticles.topicTags,
      }).from(externalArticles).where(and(
        eq(externalArticles.contentHash, hash),
        isNotNull(externalArticles.contentSummary),
        // 空字串也要排除。`isNotNull` 對 '' 是 true，而 enrichEntitySummary 的 schema
        // 是 z.string() 沒有 min()、'' 到得了——只擋 NULL 的話這個洞在 '' 那一支還在，
        // 而且 fake 分支用的是 truthiness、對 '' 的判斷會與真 DB 相反。
        ne(externalArticles.contentSummary, ''),
      )).limit(1)
      if (rows.length === 0)
        return null
      const r = rows[0]
      if (!r)
        return null
      return {
        contentSummary: r.contentSummary,
        entities: EntitiesArraySchema.parse(r.entities ?? []),
        topicTags: TopicTagsArraySchema.parse(r.topicTags ?? []),
      }
    },
    insertArticle: async (input) => {
      const realDb = getDb()
      const [row] = await realDb.insert(externalArticles).values({
        sourceId: input.sourceId,
        externalId: input.externalId,
        url: input.url,
        urlHash: input.urlHash,
        title: input.title,
        publishedAt: input.publishedAt,
        rawExcerpt: input.rawExcerpt,
        fullText: input.fullText,
        contentHash: input.contentHash,
        contentSummary: input.contentSummary,
        entities: input.entities,
        topicTags: input.topicTags,
        llmModel: input.llmModel,
        llmCostUsd: input.llmCostUsd !== null ? input.llmCostUsd.toString() : null,
      }).onConflictDoNothing({ target: [externalArticles.sourceId, externalArticles.urlHash] }).returning({ id: externalArticles.id })
      return row?.id ?? ''
    },
    isDuplicateUrl: async (sourceId, urlHash) => {
      const realDb = getDb()
      const rows = await realDb.select({ id: externalArticles.id })
        .from(externalArticles)
        .where(and(eq(externalArticles.sourceId, sourceId), eq(externalArticles.urlHash, urlHash)))
        .limit(1)
      return rows.length > 0
    },
  }
}

/** 一個啟用中來源的產出量，餵給 `@suanomics/shared` 的 `summarizeSourceSilence`。 */
export interface SourceActivityRow {
  slug: string
  articlesInWindow: number
  /**
   * 判定窗內**有摘要**（`content_summary` 非空字串）的文章數。
   *
   * 與 `articlesInWindow` 分開數，因為那兩個問的是不同的問題：一個是「有沒有列」，
   * 一個是「有沒有**可檢索**的內容」。沒 enrich 的文章 `entities`／`topic_tags` 是 `[]`，
   * retriever 的 jsonb containment 永不命中——進了 DB 也進不了檢索池。
   * 空字串一起排除：enrich 失敗與刻意不 enrich 都可能留下沒有內容的摘要欄。
   */
  usableInWindow: number
  totalArticles: number
  /** 來源列的 `created_at`（ISO）。給剛加進來、還沒輪到 refresh 的來源一個寬限期用。 */
  createdAt: string
}

/**
 * 各啟用來源在判定窗內／有史以來的文章數。
 *
 * **LEFT JOIN 不能改成 INNER**：從未產出過的來源在 `external_articles` 一列都沒有，
 * INNER JOIN 會把它們整個濾掉——而那正是這支要抓的東西（2026-08-17 實測 30 個啟用來源
 * 有 10 個從未產出）。
 *
 * 只看 `enabled` 的來源：停用的來源零產出是預期行為，不是故障。
 *
 * **窗判定一定要用 `gte()`、不能在 `sql` template 裡裸寫 `${windowStart}`**：
 * `drizzle-orm/postgres-js` 在建立 db 時把 postgres.js 的日期 serializer
 * （OID 1184/1082/1083/1114）換成 identity，改由 drizzle 自己用欄位的
 * `mapToDriverValue` 把 `Date` 轉成 ISO 字串。走 `gte()` 會帶上欄位 encoder；
 * 裸內插只會包成沒有 encoder 的 param，於是原生 `Date` 物件直接送進 driver 的
 * bind，炸在 `Buffer.byteLength`（ERR_INVALID_ARG_TYPE）。
 * 這正是 2026-08-21 那次「連續四天沒有日報」事故的成因：本端點 500 →
 * 排程觸發方以 jq 解析回應時失敗 → 整條 pipeline 沒開始跑。
 */
export async function getSourceActivity(windowStart: Date): Promise<SourceActivityRow[]> {
  const db = getDb()
  const rows = await db
    .select({
      slug: externalSources.slug,
      articlesInWindow: sql<number>`count(${externalArticles.id}) filter (where ${gte(externalArticles.fetchedAt, windowStart)})`.mapWith(Number),
      usableInWindow: sql<number>`count(${externalArticles.id}) filter (where ${gte(externalArticles.fetchedAt, windowStart)} and ${externalArticles.contentSummary} is not null and ${externalArticles.contentSummary} <> '')`.mapWith(Number),
      totalArticles: sql<number>`count(${externalArticles.id})`.mapWith(Number),
      createdAt: externalSources.createdAt,
    })
    .from(externalSources)
    .leftJoin(externalArticles, eq(externalArticles.sourceId, externalSources.id))
    .where(eq(externalSources.enabled, true))
    .groupBy(externalSources.slug, externalSources.createdAt)
  return rows.map(r => ({ ...r, createdAt: r.createdAt.toISOString() }))
}

export interface ExternalArticleByUrl { id: string, title: string, url: string, text: string }

/** null／空字串都算「這個欄位沒有內容」，跟 findEnrichmentByContentHash 同一個 '' 陷阱一致。 */
function firstNonEmpty(...vals: (string | null)[]): string | undefined {
  for (const v of vals) {
    if (v !== null && v.trim().length > 0)
      return v
  }
  return undefined
}

// pairwise judge 的事實底本原本只查 news_items，citation URL 若指向 Cascade
// 的 corpus 表（external_articles）就會靜默落空——那 18 筆引用到的數字仍會被 judge
// 判虛構。這支照 url 反查 external_articles，text 取用順序 content_summary → raw_excerpt
// → title（★實查：full_text 全表 21,534 列皆 null，不能當來源）。
export async function getExternalArticlesByUrls(urls: readonly string[]): Promise<ExternalArticleByUrl[]> {
  if (urls.length === 0)
    return []
  const db = getDb()
  const rows = await db.select({
    id: externalArticles.id,
    title: externalArticles.title,
    url: externalArticles.url,
    contentSummary: externalArticles.contentSummary,
    rawExcerpt: externalArticles.rawExcerpt,
  }).from(externalArticles).where(inArray(externalArticles.url, [...urls]))
  return rows.map(r => ({
    id: r.id,
    title: r.title,
    url: r.url,
    text: firstNonEmpty(r.contentSummary, r.rawExcerpt) ?? r.title,
  }))
}
