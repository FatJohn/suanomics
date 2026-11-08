import type { MarketBrief } from '@suanomics/shared'
import type { ItemCategory } from '../news-categories.js'
import { getDb } from '@suanomics/db/client'
import { analyses, dailyBriefs, newsItems, newsSources } from '@suanomics/db/schema'
import { and, count, desc, eq, gte, inArray, isNull, lt, lte } from 'drizzle-orm'
import { z } from 'zod'
import { partitionByCategory, resolveItemCategory } from '../news-categories.js'

// ParsedEntry was previously imported from apps/server/src/lib/brief/rss-fetcher.ts.
// Defined locally here to keep @suanomics/db free of inter-app coupling.
// Deduplication with rss-fetcher's definition happens in Task 8 when rss-fetcher moves.
export interface ParsedEntry {
  externalId: string
  title: string
  url: string
  publishedAt: Date | null
  excerpt: string
}

export interface UpsertRow {
  sourceId: number
  externalId: string
  title: string
  url: string
  publishedAt: Date | null
  contentText: string | null
  contentSource: 'rss-excerpt' | 'scrape' | 'user-paste'
}

export function buildUpsertRows(entries: readonly ParsedEntry[], sourceId: number): UpsertRow[] {
  return entries.map(e => ({
    sourceId,
    externalId: e.externalId,
    title: e.title,
    url: e.url,
    publishedAt: e.publishedAt,
    contentText: e.excerpt || null,
    contentSource: 'rss-excerpt' as const,
  }))
}

export async function getActiveSources() {
  const db = getDb()
  return db.select().from(newsSources).where(eq(newsSources.isActive, true))
}

export async function getExistingExternalIds(sourceId: number): Promise<Set<string>> {
  const db = getDb()
  const rows = await db.select({ id: newsItems.externalId }).from(newsItems).where(eq(newsItems.sourceId, sourceId))
  return new Set(rows.map(r => r.id))
}

export async function insertNewsItems(rows: readonly UpsertRow[]): Promise<number[]> {
  if (rows.length === 0)
    return []
  const db = getDb()
  const inserted = await db.insert(newsItems).values([...rows]).onConflictDoNothing().returning({ id: newsItems.id })
  return inserted.map(r => r.id)
}

export async function updateScrapedContent(id: number, text: string): Promise<void> {
  const db = getDb()
  await db.update(newsItems).set({ contentText: text, contentSource: 'scrape' }).where(eq(newsItems.id, id))
}

// ingestion 批次分類後寫回 item category。
export async function updateNewsItemCategories(updates: readonly { id: number, category: string }[]): Promise<void> {
  if (updates.length === 0)
    return
  const db = getDb()
  for (const u of updates)
    await db.update(newsItems).set({ category: u.category }).where(eq(newsItems.id, u.id))
}

// 寫回 topic_tags + 標記 tagged_at（即使 tags 為 [] 也設、確保 backfill idempotent）。
export async function updateNewsItemTopicTags(updates: readonly { id: number, topicTags: string[] }[]): Promise<void> {
  if (updates.length === 0)
    return
  const db = getDb()
  const now = new Date()
  for (const u of updates)
    await db.update(newsItems).set({ topicTags: u.topicTags, taggedAt: now }).where(eq(newsItems.id, u.id))
}

// backfill：近窗內尚未標（taggedAt IS NULL）的 items。只標會成為候選的、避免標到永不入選的舊聞。
export async function getUntaggedNewsItems(sinceDays = 30): Promise<Array<{ id: number, title: string, contentText: string | null }>> {
  const db = getDb()
  const cutoff = new Date(Date.now() - sinceDays * 864e5)
  return db
    .select({ id: newsItems.id, title: newsItems.title, contentText: newsItems.contentText })
    .from(newsItems)
    .where(and(gte(newsItems.fetchedAt, cutoff), isNull(newsItems.taggedAt)))
    .orderBy(desc(newsItems.fetchedAt))
}

export async function getRecentNewsItems(sinceDays = 7, limit = 50) {
  const db = getDb()
  const cutoff = new Date(Date.now() - sinceDays * 864e5)
  return db.select().from(newsItems).where(gte(newsItems.fetchedAt, cutoff)).orderBy(desc(newsItems.publishedAt)).limit(limit)
}

export interface StratifiedCandidate {
  id: number
  title: string
  url: string
  contentText: string | null
  category: ItemCategory
}

// 候選池分層取樣：近窗 news_items join 來源、按 item 層分類（null 退來源層）、每類取最近 perCategoryLimit 則。
// 取代純 recency（高產量總經 feed 會灌爆候選池）。
export async function getStratifiedCandidates(briefDate: string, sinceDays = 2, perCategoryLimit = 8): Promise<StratifiedCandidate[]> {
  assertBriefDate('getStratifiedCandidates', briefDate)
  const db = getDb()
  // 窗以 briefDate 為基準、不是 Date.now()。排程情境下兩者只差幾小時、窗幾乎重疊，
  // 所以這個錯誤看不出來；補產（手動觸發、帶明確 date 參數）時 now() 可能差好幾天，
  // 會拿今天的新聞貼上舊日期——而且不影響 job 成敗，外部看到的是一份成功產出的報告。
  // briefDate 必填而不是可選：這個 bug 的形狀就是參數被靜默丟棄，給預設值等於留著同一個洞。
  const cutoff = new Date(new Date(`${briefDate}T00:00:00Z`).getTime() - sinceDays * 864e5)
  const upperBound = new Date(`${briefDate}T23:59:59.999Z`)
  const rows = await db
    .select({ id: newsItems.id, title: newsItems.title, url: newsItems.url, contentText: newsItems.contentText, category: newsItems.category, slug: newsSources.slug })
    .from(newsItems)
    .innerJoin(newsSources, eq(newsItems.sourceId, newsSources.id))
    .where(and(gte(newsItems.fetchedAt, cutoff), lte(newsItems.fetchedAt, upperBound)))
    .orderBy(desc(newsItems.publishedAt))
  const withCategory: StratifiedCandidate[] = rows.map(r => ({
    id: r.id,
    title: r.title,
    url: r.url,
    contentText: r.contentText,
    category: resolveItemCategory(r.category, r.slug),
  }))
  return partitionByCategory(withCategory, c => c.category, perCategoryLimit)
}

// 相關性感知選稿：撈 sanity cap 窗內全部候選（不在 DB 層按 recency 砍頂），
// 砍頂改由 worker 的純函式 ranker 在「評分之後」做（見 apps/server/src/brief/news-relevance.ts）。
// 帶 publishedAt / fetchedAt / sourceSlug 供 ranker 算 recency 衰減與 source weight。
export interface RelevanceCandidate {
  id: number
  title: string
  url: string
  contentText: string | null
  category: ItemCategory
  publishedAt: Date | null
  fetchedAt: Date
  sourceSlug: string
  topicTags: string[]
}

// 兩條候選查詢共用。窗的兩端都從 briefDate 算，所以格式錯了不會炸、只會靜默算出一個
// 不對的窗——而這條路徑選錯窗不影響 job 成敗（見 getStratifiedCandidates 的註解）。
function assertBriefDate(fnName: string, briefDate: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(briefDate))
    throw new Error(`${fnName}: invalid briefDate "${briefDate}"`)
  // 正則擋不掉不存在的日期，而兩種壞法的症狀不一樣：'2026-13-01' 是 Invalid Date（NaN 進
  // driver、會炸），'2026-02-30' 卻被 Date 靜默 roll 成 03-02——不炸，只是安靜地算出一個
  // 差兩天的窗。後者比前者難發現，所以用「parse 回來要與輸入相符」一起擋掉。
  const parsed = new Date(`${briefDate}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime()) || !parsed.toISOString().startsWith(briefDate))
    throw new Error(`${fnName}: invalid briefDate "${briefDate}"`)
}

export async function getRelevanceCandidates(briefDate: string, sinceDays = 14): Promise<RelevanceCandidate[]> {
  assertBriefDate('getRelevanceCandidates', briefDate)
  const db = getDb()
  // 以 briefDate 為基準（非 Date.now()）→ 重生歷史簡報可重現
  const cutoff = new Date(new Date(`${briefDate}T00:00:00Z`).getTime() - sinceDays * 864e5)
  // 上界鎖在 briefDate 當天結束（UTC）→ 防止重生歷史簡報時拉入 briefDate 之後才抓到的新聞
  const upperBound = new Date(`${briefDate}T23:59:59.999Z`)
  const rows = await db
    .select({
      id: newsItems.id,
      title: newsItems.title,
      url: newsItems.url,
      contentText: newsItems.contentText,
      category: newsItems.category,
      publishedAt: newsItems.publishedAt,
      fetchedAt: newsItems.fetchedAt,
      topicTags: newsItems.topicTags,
      slug: newsSources.slug,
    })
    .from(newsItems)
    .innerJoin(newsSources, eq(newsItems.sourceId, newsSources.id))
    .where(and(gte(newsItems.fetchedAt, cutoff), lte(newsItems.fetchedAt, upperBound)))
    .orderBy(desc(newsItems.publishedAt))
  return rows.map(r => ({
    id: r.id,
    title: r.title,
    url: r.url,
    contentText: r.contentText,
    category: resolveItemCategory(r.category, r.slug),
    publishedAt: r.publishedAt,
    fetchedAt: r.fetchedAt,
    sourceSlug: r.slug,
    topicTags: Array.isArray(r.topicTags) ? (r.topicTags as string[]) : [],
  }))
}

export async function getNewsItemById(id: number) {
  const db = getDb()
  const rows = await db.select().from(newsItems).where(eq(newsItems.id, id)).limit(1)
  return rows[0] ?? null
}

export async function getNewsItemsByIds(ids: readonly number[]) {
  if (ids.length === 0)
    return []
  const db = getDb()
  return db.select().from(newsItems).where(inArray(newsItems.id, [...ids]))
}

// pairwise judge 底本要收「兩臂 citations 引用過的新聞」，citations 只有 url、
// 沒有 newsId，所以要一支照 url 反查的查詢。空陣列直接回 []、不要讓 inArray 收到空陣列
// （drizzle 對空陣列的 inArray 語意不保證是「永假」、直接短路比較保險）。
export async function getNewsItemsByUrls(urls: readonly string[]) {
  if (urls.length === 0)
    return []
  const db = getDb()
  return db.select().from(newsItems).where(inArray(newsItems.url, [...urls]))
}

export async function saveAnalysis(opts: {
  newsItemId: number | null
  payload: MarketBrief
  model: string
  promptHash: string
  inputHash: string
  inputUrl: string | null
  entities: string[]
  expiresAt: Date
}): Promise<number> {
  const db = getDb()
  const [row] = await db.insert(analyses).values({
    newsItemId: opts.newsItemId,
    payload: opts.payload,
    model: opts.model,
    promptHash: opts.promptHash,
    inputHash: opts.inputHash,
    inputUrl: opts.inputUrl,
    entities: opts.entities,
    expiresAt: opts.expiresAt,
  }).returning({ id: analyses.id })
  if (!row)
    throw new Error('saveAnalysis: insert returned no row')
  return row.id
}

export async function getLatestAnalysis(newsItemId: number) {
  const db = getDb()
  const rows = await db.select().from(analyses).where(and(eq(analyses.newsItemId, newsItemId))).orderBy(desc(analyses.createdAt)).limit(1)
  return rows[0] ?? null
}

export async function saveDailyBrief(
  briefDate: string,
  selectedIds: readonly number[],
  summary: string,
  briefJson?: unknown,
): Promise<number> {
  const db = getDb()
  const insertValues = { briefDate, selectedNewsIds: [...selectedIds], summary, ...(briefJson !== undefined ? { briefJson } : {}) }
  const updateSet = { selectedNewsIds: [...selectedIds], summary, ...(briefJson !== undefined ? { briefJson } : {}) }
  const [row] = await db.insert(dailyBriefs).values(insertValues).onConflictDoUpdate({ target: dailyBriefs.briefDate, set: updateSet }).returning({ id: dailyBriefs.id })
  if (!row)
    throw new Error('saveDailyBrief: upsert returned no row')
  return row.id
}

export async function getLatestDailyBrief() {
  const db = getDb()
  const rows = await db.select().from(dailyBriefs).orderBy(desc(dailyBriefs.briefDate)).limit(1)
  return rows[0] ?? null
}

// briefDate 是 upsert unique key（每日一筆）、不需 DISTINCT。frontend 日期切換器用。
export async function listDailyBriefDates(): Promise<string[]> {
  const db = getDb()
  const rows = await db
    .select({ briefDate: dailyBriefs.briefDate })
    .from(dailyBriefs)
    .orderBy(desc(dailyBriefs.briefDate))
  return rows.map(r => r.briefDate)
}

const BriefHeadlineSchema = z.object({ headline: z.string() })

// editor 需要近日 brief 摘要當 context、headline 優先取 briefJson、無則 fallback summary 首行
/**
 * 最近 n 份日報的摘要（新到舊），給 editor 的「近三日 brief」。
 *
 * `before`（`YYYY-MM-DD`）是**不含**當日的上界。補跑歷史報告時少了它，09-02 的報告會在
 * editor prompt 裡逐字印著「2026-09-04：…」——日期標得誠實，但那天還不存在
 * （2026-09-06 驗收指出，與序列快照、行事曆同一個形狀）。不含當日還順手治好另一件事：
 * 重生同一天的報告時，它不該把自己的上一版當成「近三日」讀進去。
 * 不帶 `before` 就是無上界。
 */
export async function getRecentBriefSummaries(n: number, before?: string): Promise<{ briefDate: string, headline: string, summary: string }[]> {
  const db = getDb()
  const rows = await db.select({ briefDate: dailyBriefs.briefDate, summary: dailyBriefs.summary, briefJson: dailyBriefs.briefJson })
    .from(dailyBriefs)
    .where(before === undefined ? undefined : lt(dailyBriefs.briefDate, before))
    .orderBy(desc(dailyBriefs.briefDate))
    .limit(n)
  return rows.map((r) => {
    const parsed = BriefHeadlineSchema.safeParse(r.briefJson)
    return { briefDate: r.briefDate, summary: r.summary, headline: parsed.success ? parsed.data.headline : (r.summary.split('\n')[0] ?? '') }
  })
}

export async function getDailyBriefByDate(briefDate: string) {
  const db = getDb()
  const rows = await db.select().from(dailyBriefs).where(eq(dailyBriefs.briefDate, briefDate)).limit(1)
  return rows[0] ?? null
}

// publication status：只取狀態判定需要的欄位、一次查多日（≤31）。
export interface DailyBriefPublicationRow {
  briefDate: string
  createdAt: Date
  briefJson: unknown
  podcastJson: unknown
  podcastAudioPath: string | null
}

export async function getDailyBriefsForDates(dates: readonly string[]): Promise<DailyBriefPublicationRow[]> {
  if (dates.length === 0)
    return []
  const db = getDb()
  return db.select({
    briefDate: dailyBriefs.briefDate,
    createdAt: dailyBriefs.createdAt,
    briefJson: dailyBriefs.briefJson,
    podcastJson: dailyBriefs.podcastJson,
    podcastAudioPath: dailyBriefs.podcastAudioPath,
  }).from(dailyBriefs).where(inArray(dailyBriefs.briefDate, [...dates]))
}

// freshness signal：窗內 news 進量（news_items 是 brief pipeline 輸入表）。
export async function countNewsFetchedBetween(from: Date, to: Date): Promise<number> {
  const db = getDb()
  const rows = await db.select({ n: count() }).from(newsItems).where(and(gte(newsItems.fetchedAt, from), lt(newsItems.fetchedAt, to)))
  return rows[0]?.n ?? 0
}

export interface BriefNewsItem { id: number, title: string, url: string, text: string }

export async function selectNewsForBrief(date: string): Promise<BriefNewsItem[]> {
  // fallback 也走分層，避免高產量總經 feed 在 degraded 路徑 over-rotate
  const recent = await getStratifiedCandidates(date, 7, 3)
  return recent.map(r => ({
    id: r.id,
    title: r.title,
    url: r.url,
    text: r.contentText ?? r.title,
  }))
}
