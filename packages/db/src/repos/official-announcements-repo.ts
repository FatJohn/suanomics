import { getDb } from '@suanomics/db/client'
import { externalArticles, externalSources } from '@suanomics/db/schema'
import { and, desc, eq, gte, inArray, isNotNull, lte } from 'drizzle-orm'

/** 一則官方公告，形狀對齊 worker 的 `OfficialAnnouncement`（那邊是純函式、不依賴 drizzle）。 */
export interface OfficialAnnouncementRow {
  slug: string
  title: string
  summary: string | null
  publishedAt: Date
}

/**
 * 金融主管機關的近期公告。**讀 `external_articles`、不是 `news_items`**——這兩張表是
 * 兩套獨立的抓取系統，官方來源只在前者。
 *
 * 這支是「附加區塊」路線的資料入口：官方公告不進選稿池（實測會被埋在一般新聞排名之後），
 * 改成當背景素材餵給 editor 與 narrative。
 *
 * ★ `publishedAt` 可為 null（feed 沒給 pubDate），那種列**不回**——block 每行都以日期
 * 開頭，少了日期的公告在 prompt 裡會變成一則沒有時間錨點的宣稱，比不給更糟。
 *
 * ★ **上下界都要**。只有下界的話，重生歷史報告會撈到報告日之後才發布的公告——報告
 * 照樣產得出來，只是多了當時不存在的素材，而那是靜默的。判準同 `getRelevanceCandidates`。
 *
 * ★ 窗判定用 `gte()`／`lte()`、不要在 `sql` template 裡裸內插 Date（drizzle 換掉
 * postgres-js 的日期 serializer，裸內插會炸在 driver 的 bind）。
 */
export async function getRecentOfficialAnnouncements(
  slugs: readonly string[],
  windowStart: Date,
  windowEnd: Date,
  limit = 40,
): Promise<OfficialAnnouncementRow[]> {
  if (slugs.length === 0)
    return []
  const db = getDb()
  const rows = await db
    .select({
      slug: externalSources.slug,
      title: externalArticles.title,
      summary: externalArticles.contentSummary,
      publishedAt: externalArticles.publishedAt,
    })
    .from(externalArticles)
    .innerJoin(externalSources, eq(externalSources.id, externalArticles.sourceId))
    .where(and(
      inArray(externalSources.slug, [...slugs]),
      isNotNull(externalArticles.publishedAt),
      gte(externalArticles.publishedAt, windowStart),
      lte(externalArticles.publishedAt, windowEnd),
    ))
    .orderBy(desc(externalArticles.publishedAt))
    .limit(limit)
  return rows
    .filter((r): r is typeof r & { publishedAt: Date } => r.publishedAt !== null)
    .map(r => ({ slug: r.slug, title: r.title, summary: r.summary, publishedAt: r.publishedAt }))
}
