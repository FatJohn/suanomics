import { date, integer, jsonb, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core'

// apps/web 不得 import apps/pipeline，schema 也不能放只允許 zod 的 packages/shared，
// 所以在這裡只宣告網站會讀的欄位。欄位漂移由 site-repo.db.test.ts 對真 migration 擋下。
export const dailyBriefs = pgTable('daily_briefs', {
  briefDate: date('brief_date').notNull(),
  selectedNewsIds: integer('selected_news_ids').array().notNull(),
  briefJson: jsonb('brief_json').$type<unknown>(),
  status: text('status').notNull(),
})

export const newsSources = pgTable('news_sources', {
  id: serial('id').primaryKey(),
  displayName: text('display_name').notNull(),
})

export const newsItems = pgTable('news_items', {
  id: serial('id').primaryKey(),
  sourceId: integer('source_id').notNull(),
  title: text('title').notNull(),
  url: text('url').notNull(),
  publishedAt: timestamp('published_at', { withTimezone: true }),
})
