import process from 'node:process'
import postgres from 'postgres'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { readSiteRows } from './site-repo'

const url = process.env.DATABASE_URL
if (!url)
  throw new Error('DATABASE_URL 未設定：這個測試要連本機或 CI 的 Postgres container')

const sql = postgres(url, { max: 1 })
const SLUG = 'web26-source'
const COMPLETE = '2097-04-02'
const OLDER = '2097-04-01'
const INCOMPLETE = '2097-04-03'
// 測試跨 workspace 並行且共用資料庫：日期與 fetched_at 都放在 pipeline 測試的查詢窗之外。
const FAR = '2097-04-01T00:00:00Z'

async function cleanup(): Promise<void> {
  await sql`DELETE FROM daily_briefs WHERE brief_date IN (${COMPLETE}, ${OLDER}, ${INCOMPLETE})`
  await sql`DELETE FROM news_items WHERE external_id LIKE 'web26-%'`
  await sql`DELETE FROM news_sources WHERE slug = ${SLUG}`
}

describe('readSiteRows', () => {
  beforeEach(cleanup)
  afterAll(async () => {
    await cleanup()
    await sql.end()
  })

  it('只讀 complete 的 brief、新到舊，新聞帶來源名稱', async () => {
    await sql`INSERT INTO daily_briefs (brief_date, selected_news_ids, summary, status) VALUES
      (${OLDER}, '{}', 's', 'complete'), (${COMPLETE}, '{}', 's', 'complete'), (${INCOMPLETE}, '{}', '', 'incomplete')`
    const [source] = await sql`INSERT INTO news_sources (slug, display_name, rss_url) VALUES (${SLUG}, '測試來源', 'https://example.com/r.xml') RETURNING id`
    await sql`INSERT INTO news_items (source_id, external_id, title, url, content_source, fetched_at, published_at)
      VALUES (${source?.id}, 'web26-1', '標題', 'https://example.com/1', 'rss-excerpt', ${FAR}, ${FAR})`

    const { briefs, news } = await readSiteRows(url as string)

    const mine = briefs.map(b => b.briefDate).filter(d => [COMPLETE, OLDER, INCOMPLETE].includes(d))
    expect(mine).toEqual([COMPLETE, OLDER])
    expect(news.find(n => n.url === 'https://example.com/1')).toMatchObject({ title: '標題', sourceName: '測試來源' })
  })
})
