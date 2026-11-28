import { asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { dailyBriefs, newsItems, newsSources } from './schema'

export interface BriefRow { briefDate: string, selectedNewsIds: number[], briefJson: unknown, audioUrl: string | null }
export interface NewsRow { id: number, title: string, url: string, publishedAt: Date | null, sourceName: string }
export interface SiteRows { briefs: BriefRow[], news: NewsRow[], citedNews: NewsRow[] }

export async function readSiteRows(databaseUrl: string): Promise<SiteRows> {
  // 用完就關：留著閒置連線 astro build 不會結束。
  const client = postgres(databaseUrl, { max: 1 })
  try {
    const db = drizzle(client)
    const briefs = await db
      .select({ briefDate: dailyBriefs.briefDate, selectedNewsIds: dailyBriefs.selectedNewsIds, briefJson: dailyBriefs.briefJson, audioUrl: dailyBriefs.podcastAudioPath })
      .from(dailyBriefs)
      .where(eq(dailyBriefs.status, 'complete'))
      .orderBy(desc(dailyBriefs.briefDate))
    // 只取已發佈 brief 的選稿：其餘新聞沒有站內入口，全產會讓頁數隨 ingest 無上限成長。
    const selectedIds = [...new Set(briefs.flatMap(b => b.selectedNewsIds))]
    const newsColumns = { id: newsItems.id, title: newsItems.title, url: newsItems.url, publishedAt: newsItems.publishedAt, sourceName: newsSources.displayName }
    const news = await db
      .select(newsColumns)
      .from(newsItems)
      .innerJoin(newsSources, eq(newsItems.sourceId, newsSources.id))
      .where(inArray(newsItems.id, selectedIds))
    // 出處區要每則引用的來源名與日期；引用網址在 brief_json 裡，用同一次查詢對回新聞表。
    const citedUrls = sql`(SELECT jsonb_array_elements(${dailyBriefs.briefJson}->'citations')->>'url' FROM ${dailyBriefs}
      WHERE ${dailyBriefs.status} = 'complete' AND jsonb_typeof(${dailyBriefs.briefJson}->'citations') = 'array')`
    const citedNews = await db
      .select(newsColumns)
      .from(newsItems)
      .innerJoin(newsSources, eq(newsItems.sourceId, newsSources.id))
      .where(sql`${newsItems.url} IN ${citedUrls}`)
      .orderBy(asc(newsItems.id))
    return { briefs, news, citedNews }
  }
  finally {
    await client.end()
  }
}
