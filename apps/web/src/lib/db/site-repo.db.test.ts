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

  it('只讀 complete 的 brief、新到舊；新聞只取 complete brief 選到或引用到的，帶來源名稱', async () => {
    const [source] = await sql`INSERT INTO news_sources (slug, display_name, rss_url) VALUES (${SLUG}, '測試來源', 'https://example.com/r.xml') RETURNING id`
    const insertNews = async (key: string): Promise<number> => {
      const [row] = await sql`INSERT INTO news_items (source_id, external_id, title, url, content_source, fetched_at, published_at)
        VALUES (${source?.id}, ${`web26-${key}`}, ${key}, ${`https://example.com/${key}`}, 'rss-excerpt', ${FAR}, ${FAR}) RETURNING id`
      return row?.id as number
    }
    const selected = await insertNews('selected')
    const onlyIncomplete = await insertNews('only-incomplete')
    await insertNews('unselected')
    const cited = await insertNews('cited')
    await insertNews('cited-incomplete')
    const citing = (key: string) => sql.json({ citations: [{ title: key, url: `https://example.com/${key}`, quote: 'q' }] })
    await sql`INSERT INTO daily_briefs (brief_date, selected_news_ids, summary, status, podcast_audio_path, brief_json) VALUES
      (${OLDER}, ${`{${selected}}`}, 's', 'complete', null, null), (${COMPLETE}, '{}', 's', 'complete', 'https://audio.example.com/c.mp3', ${citing('cited')}), (${INCOMPLETE}, ${`{${onlyIncomplete}}`}, '', 'incomplete', null, ${citing('cited-incomplete')})`

    const { briefs, news, citedNews } = await readSiteRows(url as string)

    const mine = briefs.filter(b => [COMPLETE, OLDER, INCOMPLETE].includes(b.briefDate))
    expect(mine.map(b => [b.briefDate, b.audioUrl])).toEqual([[COMPLETE, 'https://audio.example.com/c.mp3'], [OLDER, null]])
    const myNews = news.filter(n => n.url.startsWith('https://example.com/'))
    expect(myNews).toMatchObject([{ id: selected, title: 'selected', sourceName: '測試來源' }])
    // 引用來源只要 complete brief 引用到的新聞，給出處區對來源名與日期；不產新聞頁，所以和選稿分開回。
    const myCited = citedNews.filter(n => n.url.startsWith('https://example.com/'))
    expect(myCited).toMatchObject([{ id: cited, url: 'https://example.com/cited', sourceName: '測試來源', publishedAt: new Date(FAR) }])
  })
})
