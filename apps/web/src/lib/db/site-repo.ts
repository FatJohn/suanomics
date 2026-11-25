import { desc, eq, inArray } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { dailyBriefs, newsItems, newsSources } from './schema'

export interface BriefRow { briefDate: string, selectedNewsIds: number[], briefJson: unknown }
export interface NewsRow { id: number, title: string, url: string, publishedAt: Date | null, sourceName: string }
export interface SiteRows { briefs: BriefRow[], news: NewsRow[] }

export async function readSiteRows(databaseUrl: string): Promise<SiteRows> {
  // 用完就關：留著閒置連線 astro build 不會結束。
  const client = postgres(databaseUrl, { max: 1 })
  try {
    const db = drizzle(client)
    const briefs = await db
      .select({ briefDate: dailyBriefs.briefDate, selectedNewsIds: dailyBriefs.selectedNewsIds, briefJson: dailyBriefs.briefJson })
      .from(dailyBriefs)
      .where(eq(dailyBriefs.status, 'complete'))
      .orderBy(desc(dailyBriefs.briefDate))
    // 只取已發佈 brief 的選稿：其餘新聞沒有站內入口，全產會讓頁數隨 ingest 無上限成長。
    const selectedIds = [...new Set(briefs.flatMap(b => b.selectedNewsIds))]
    const news = await db
      .select({ id: newsItems.id, title: newsItems.title, url: newsItems.url, publishedAt: newsItems.publishedAt, sourceName: newsSources.displayName })
      .from(newsItems)
      .innerJoin(newsSources, eq(newsItems.sourceId, newsSources.id))
      .where(inArray(newsItems.id, selectedIds))
    return { briefs, news }
  }
  finally {
    await client.end()
  }
}
