import { randomUUID } from 'node:crypto'
import { closeDb, getDb } from '@suanomics/db/client'
import { externalArticles, externalSources } from '@suanomics/db/schema'
import { inArray, like } from 'drizzle-orm'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getRecentOfficialAnnouncements } from './official-announcements-repo.js'

// 真 DB 測試：窗判定的日期 bind、publishedAt 為 null 的排除、以及 slug 過濾，
// 只有真的送到 Postgres 才驗得出來。
// ★ 清理前綴 `test-official-` 全 repo 唯一。★ 錨在遠離「今天」的日期（理由同其他 db 測試）。
const DAY_MS = 86_400_000
const NOW = new Date('2025-05-10T04:00:00.000Z')

async function cleanup() {
  const db = getDb()
  const mine = await db.select({ id: externalSources.id }).from(externalSources).where(like(externalSources.slug, 'test-official-%'))
  if (mine.length > 0)
    await db.delete(externalArticles).where(inArray(externalArticles.sourceId, mine.map(r => r.id)))
  await db.delete(externalSources).where(like(externalSources.slug, 'test-official-%'))
}

async function seedSource(slug: string): Promise<string> {
  const [row] = await getDb().insert(externalSources).values({
    slug,
    displayName: slug,
    kind: 'rss',
    tier: 1,
    config: { feedUrl: 'https://example.invalid/feed' },
  }).returning({ id: externalSources.id })
  if (!row)
    throw new Error(`seedSource failed: ${slug}`)
  return row.id
}

async function seedArticle(sourceId: string, publishedAt: Date | null, title: string, summary: string | null) {
  const id = randomUUID()
  await getDb().insert(externalArticles).values({
    sourceId,
    url: `https://example.invalid/${id}`,
    urlHash: id,
    title,
    publishedAt,
    contentSummary: summary,
  })
}

describe('getRecentOfficialAnnouncements (real DB)', () => {
  beforeEach(cleanup)
  afterEach(cleanup)
  afterAll(async () => {
    await closeDb()
  })

  it('只回指定 slug、窗內、且有 publishedAt 的公告，新到舊', async () => {
    const wanted = await seedSource('test-official-cbc')
    const other = await seedSource('test-official-other')
    await seedArticle(wanted, new Date(NOW.getTime() - DAY_MS), '新的', '摘要 A')
    await seedArticle(wanted, new Date(NOW.getTime() - 2 * DAY_MS), '舊的', null)
    await seedArticle(wanted, new Date(NOW.getTime() - 30 * DAY_MS), '窗外的', null)
    // ★ publishedAt 為 null 的刻意排除：block 每行以日期開頭，少了日期會變成沒有
    //   時間錨點的宣稱，比不給更糟。
    await seedArticle(wanted, null, '沒有日期的', null)
    await seedArticle(other, new Date(NOW.getTime() - DAY_MS), '別的來源', null)

    const rows = await getRecentOfficialAnnouncements(['test-official-cbc'], new Date(NOW.getTime() - 7 * DAY_MS), NOW)
    expect(rows.map(r => r.title)).toEqual(['新的', '舊的'])
    expect(rows[0]?.summary).toBe('摘要 A')
    expect(rows[1]?.summary).toBeNull()
    expect(rows[0]?.slug).toBe('test-official-cbc')
  })

  // ★ 上界不是可選的：重生歷史報告時，報告日之後才發布的公告不該出現。
  it('鎖住上界——窗結束之後才發布的公告不回', async () => {
    const src = await seedSource('test-official-cbc')
    await seedArticle(src, new Date(NOW.getTime() - DAY_MS), '窗內', null)
    await seedArticle(src, new Date(NOW.getTime() + DAY_MS), '窗後才發布', null)
    const rows = await getRecentOfficialAnnouncements(['test-official-cbc'], new Date(NOW.getTime() - 7 * DAY_MS), NOW)
    expect(rows.map(r => r.title)).toEqual(['窗內'])
  })

  it('slug 清單為空時回空陣列，不打 DB 也不回整張表', async () => {
    const src = await seedSource('test-official-cbc')
    await seedArticle(src, new Date(NOW.getTime() - DAY_MS), '不該被回', null)
    expect(await getRecentOfficialAnnouncements([], new Date(NOW.getTime() - 7 * DAY_MS), NOW)).toEqual([])
  })

  it('limit 生效（窗內公告可能很多，prompt 預算是硬的）', async () => {
    const src = await seedSource('test-official-cbc')
    for (let i = 0; i < 5; i++)
      await seedArticle(src, new Date(NOW.getTime() - (i + 1) * 3600_000), `公告 ${i}`, null)
    const rows = await getRecentOfficialAnnouncements(['test-official-cbc'], new Date(NOW.getTime() - 7 * DAY_MS), NOW, 2)
    expect(rows).toHaveLength(2)
    expect(rows[0]?.title).toBe('公告 0')
  })
})
