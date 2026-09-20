import { getDb } from '@suanomics/db/client'
import { newsItems, newsSources } from '@suanomics/db/schema'
import { count, eq, gte } from 'drizzle-orm'

/** 一列 `news_sources` 的現況，加上有史以來的則數。 */
export interface NewsHealthSourceRow {
  slug: string
  displayName: string
  rssUrl: string
  isActive: boolean
  totalItems: number
}

/** 判定窗內的一則 `news_items`，只取判定要用的欄位。 */
export interface NewsHealthItemRow {
  slug: string
  title: string
  contentText: string | null
  contentSource: string
  publishedAt: Date | null
}

/**
 * `news:health` 的原始素材：來源現況 + 窗內的每一則。
 *
 * **判定不在 SQL 做**，理由與 `news-source-activity.ts` 相同：可用與否的判準是
 * `hasBodyBeyondTitle`（要剝標記與 entity、正規化標點再比對），用 `regexp_replace`
 * 疊出來的 SQL 版遲早與 JS 那份分岔，而分岔方向是靜默的（SQL 說健康、實際不可用）。
 *
 * **停用來源也回**：一個被停用卻還在 DB 裡的來源，正是要看見的東西之一
 * （seed 只做 upsert，把設定從 SEED 刪掉不會讓 DB 那列停用）。
 *
 * ★ 窗判定用 `gte()`、**不要在 `sql` template 裡裸內插 `windowStart`**——drizzle 會把
 * postgres-js 的日期 serializer 換掉，裸內插的 Date 會炸在 driver 的 bind。
 */
export async function getNewsHealthRaw(windowStart: Date): Promise<{
  sources: NewsHealthSourceRow[]
  items: NewsHealthItemRow[]
}> {
  const db = getDb()
  const sources = await db
    .select({
      slug: newsSources.slug,
      displayName: newsSources.displayName,
      rssUrl: newsSources.rssUrl,
      isActive: newsSources.isActive,
      totalItems: count(newsItems.id),
    })
    .from(newsSources)
    .leftJoin(newsItems, eq(newsItems.sourceId, newsSources.id))
    .groupBy(newsSources.slug, newsSources.displayName, newsSources.rssUrl, newsSources.isActive)

  const items = await db
    .select({
      slug: newsSources.slug,
      title: newsItems.title,
      contentText: newsItems.contentText,
      contentSource: newsItems.contentSource,
      publishedAt: newsItems.publishedAt,
    })
    .from(newsItems)
    .innerJoin(newsSources, eq(newsItems.sourceId, newsSources.id))
    .where(gte(newsItems.fetchedAt, windowStart))

  return { sources, items }
}
