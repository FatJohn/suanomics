import { sql } from 'drizzle-orm'
import { boolean, check, date, index, integer, jsonb, numeric, pgTable, serial, smallint, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'

export const newsSources = pgTable('news_sources', {
  id: serial('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  displayName: text('display_name').notNull(),
  rssUrl: text('rss_url').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const newsItems = pgTable('news_items', {
  id: serial('id').primaryKey(),
  sourceId: integer('source_id').notNull().references(() => newsSources.id),
  externalId: text('external_id').notNull(),
  title: text('title').notNull(),
  url: text('url').notNull(),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  contentText: text('content_text'),
  contentSource: text('content_source').notNull(), // 'rss-excerpt' | 'scrape' | 'user-paste'
  category: text('category'), // ItemCategory | null（ingestion LLM 打標、null=未標、selection 退來源層）
  topicTags: jsonb('topic_tags').notNull().default(sql`'[]'::jsonb`), // per-item LLM 故事標籤、dedup 聚類鍵
  taggedAt: timestamp('tagged_at', { withTimezone: true }), // null=尚未標、backfill/refresh idempotent 依此
}, t => ({
  sourceExternalUnique: unique().on(t.sourceId, t.externalId),
  publishedIdx: index('idx_news_items_published').on(t.publishedAt),
}))

export const analyses = pgTable('analyses', {
  // ── 既有 ──
  id: serial('id').primaryKey(),
  newsItemId: integer('news_item_id').references(() => newsItems.id),
  schemaVersion: text('schema_version').notNull().default('v1'),
  payload: jsonb('payload').notNull(),
  model: text('model').notNull(),
  promptHash: text('prompt_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

  // ── 新加 ──
  inputHash: text('input_hash'),
  inputUrl: text('input_url'),
  entities: jsonb('entities').notNull().default(sql`'[]'::jsonb`),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
}, t => ({
  newsItemIdx: index('idx_analyses_news_item').on(t.newsItemId),
  inputHashIdx: index('idx_analyses_input_hash').on(t.inputHash),
  entitiesGinIdx: index('idx_analyses_entities_gin').using('gin', t.entities, sql`jsonb_path_ops`),
  createdAtIdx: index('idx_analyses_created_at').on(t.createdAt.desc()),
  expiresAtIdx: index('idx_analyses_expires_at').on(t.expiresAt),
}))

export const dailyBriefs = pgTable('daily_briefs', {
  id: serial('id').primaryKey(),
  briefDate: date('brief_date').notNull().unique(),
  selectedNewsIds: integer('selected_news_ids').array().notNull(),
  summary: text('summary').notNull(),
  // 存完整 MarketBrief JSON（含 narrative / cascadeChains / newsTitlesById / 等所有 structured 欄位）
  // nullable 為既有 row 向後相容、新 worker 寫入後 frontend 才有 narrative 可 render
  briefJson: jsonb('brief_json').$type<unknown>(),
  // nullable jsonb, written by podcast-generate CLI only (no auto-gen)
  podcastJson: jsonb('podcast_json').$type<unknown>(),
  // TTS audio 檔案路徑（container local relative）+ 生成時間戳
  // path null = 尚未跑 podcast:tts、應 fallback frontend stub
  podcastAudioPath: text('podcast_audio_path'),
  podcastAudioGeneratedAt: timestamp('podcast_audio_generated_at', { withTimezone: true }),
  // 'incomplete' = 花費閘中止；此時 brief_json 為 null，已完成階段的產出在 progress。
  status: text('status').notNull().default('complete'),
  progress: jsonb('progress').$type<unknown>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => ({
  statusCheck: check('daily_briefs_status_check', sql`${t.status} IN ('complete', 'incomplete')`),
}))

export const externalSources = pgTable('external_sources', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  displayName: text('display_name').notNull(),
  kind: text('kind').notNull(),
  tier: smallint('tier').notNull(),
  config: jsonb('config').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => ({
  kindCheck: check('external_sources_kind_check', sql`${t.kind} IN ('rss', 'html-selector', 'official-feed')`),
  tierCheck: check('external_sources_tier_check', sql`${t.tier} IN (1, 2)`),
}))

export const externalArticles = pgTable('external_articles', {
  id: uuid('id').primaryKey().defaultRandom(),
  sourceId: uuid('source_id').notNull().references(() => externalSources.id, { onDelete: 'cascade' }),
  externalId: text('external_id'),
  url: text('url').notNull(),
  urlHash: text('url_hash').notNull(),
  title: text('title').notNull(),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  rawExcerpt: text('raw_excerpt'),
  fullText: text('full_text'),
  contentHash: text('content_hash'),
  contentSummary: text('content_summary'),
  entities: jsonb('entities').notNull().default(sql`'[]'::jsonb`),
  topicTags: jsonb('topic_tags').notNull().default(sql`'[]'::jsonb`),
  llmModel: text('llm_model'),
  llmCostUsd: numeric('llm_cost_usd', { precision: 10, scale: 6 }),
}, t => ({
  sourceUrlUnique: unique('external_articles_source_url_unique').on(t.sourceId, t.urlHash),
  urlHashIdx: index('idx_external_articles_url_hash').on(t.urlHash),
  contentHashIdx: index('idx_external_articles_content_hash').on(t.contentHash),
  fetchedAtIdx: index('idx_external_articles_fetched_at').on(t.fetchedAt.desc()),
}))

// market data：transform 後的數值序列落地
export const marketDataPoints = pgTable('market_data_points', {
  id: serial('id').primaryKey(),
  seriesId: text('series_id').notNull(),
  date: date('date').notNull(),
  value: numeric('value', { precision: 18, scale: 6 }).notNull(),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
}, t => ({
  seriesDateUnique: unique('market_data_points_series_date_unique').on(t.seriesId, t.date),
  seriesDateIdx: index('idx_market_data_series_date').on(t.seriesId, t.date.desc()),
}))

// storylines：跨日敘事線
export const storylines = pgTable('storylines', {
  id: serial('id').primaryKey(),
  title: text('title').notNull(),
  thesis: text('thesis').notNull(),
  status: text('status').notNull().default('open'),
  entities: jsonb('entities').notNull().default(sql`'[]'::jsonb`),
  updates: jsonb('updates').notNull().default(sql`'[]'::jsonb`),
  lastTouchedBriefDate: date('last_touched_brief_date'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => ({
  statusCheck: check('storylines_status_check', sql`${t.status} IN ('open', 'confirmed', 'refuted', 'dormant')`),
  statusIdx: index('idx_storylines_status').on(t.status),
}))

// 每日各新聞來源的抓取結果，用來判斷連續失敗（ADR 0002）。
export const sourceFetchResults = pgTable('source_fetch_results', {
  id: serial('id').primaryKey(),
  runDate: date('run_date').notNull(),
  slug: text('slug').notNull(),
  failed: boolean('failed').notNull(),
  httpStatus: integer('http_status'),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
}, t => ({
  dateSlugUnique: unique('source_fetch_results_date_slug_unique').on(t.runDate, t.slug),
  runDateIdx: index('idx_source_fetch_results_run_date').on(t.runDate.desc()),
}))

// TWSE／TPEx 每日重大訊息；端點只回最新一日，靠這張表累積。
export const materialAnnouncements = pgTable('material_announcements', {
  id: serial('id').primaryKey(),
  market: text('market').notNull(), // 'twse' | 'tpex'
  companyCode: text('company_code').notNull(),
  companyName: text('company_name').notNull(),
  announcedAt: timestamp('announced_at', { withTimezone: true }).notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  clause: text('clause').notNull(),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
}, t => ({
  announcementUnique: unique('material_announcements_unique').on(t.market, t.companyCode, t.announcedAt, t.title),
  announcedAtIdx: index('idx_material_announcements_announced_at').on(t.announcedAt.desc()),
}))

export const econCalendarEvents = pgTable('econ_calendar_events', {
  id: serial('id').primaryKey(),
  date: date('date').notNull(),
  title: text('title').notNull(),
  region: text('region').notNull(), // 'US' | 'TW' | 'GLOBAL'
  importance: text('importance').notNull(), // 'high' | 'medium' | 'low'
  source: text('source').notNull(), // 'manual' | 'fed-json'
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
}, t => ({
  eventUnique: unique('econ_calendar_events_date_title_unique').on(t.date, t.title),
  dateIdx: index('idx_econ_calendar_events_date').on(t.date),
}))
