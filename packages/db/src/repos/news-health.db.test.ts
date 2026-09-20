import { randomUUID } from 'node:crypto'
import { closeDb, getDb } from '@suanomics/db/client'
import { newsItems, newsSources } from '@suanomics/db/schema'
import { inArray, like } from 'drizzle-orm'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getNewsHealthRaw } from './news-health.js'

// 真 DB 整合測試。窗判定的日期 bind、leftJoin 的 count 對零則來源、以及停用來源會不會
// 被 join 條件吃掉，這三件事只有真的送到 Postgres 才驗得出來。
//
// ★ 清理前綴 `test-nhealth-` 全 repo 唯一（vitest 平行跑檔案，撞前綴會互刪對方剛 seed
//   的資料，症狀是「單獨跑全綠、一起跑紅**別人**那支」）。
// ★ 錨在遠離「今天」的日期，理由同 news-source-activity.db.test.ts。
const DAY_MS = 86_400_000
const NOW = new Date('2025-04-20T04:00:00.000Z')

async function cleanup() {
  const db = getDb()
  const mine = await db.select({ id: newsSources.id }).from(newsSources).where(like(newsSources.slug, 'test-nhealth-%'))
  if (mine.length > 0)
    await db.delete(newsItems).where(inArray(newsItems.sourceId, mine.map(r => r.id)))
  await db.delete(newsSources).where(like(newsSources.slug, 'test-nhealth-%'))
}

async function seedSource(slug: string, isActive = true): Promise<number> {
  const [row] = await getDb().insert(newsSources).values({
    slug,
    displayName: `名稱 ${slug}`,
    rssUrl: 'https://example.invalid/feed',
    isActive,
  }).returning({ id: newsSources.id })
  if (!row)
    throw new Error(`seedSource failed: ${slug}`)
  return row.id
}

async function seedItem(sourceId: number, fetchedAt: Date, over: {
  publishedAt?: Date | null
  contentSource?: string
  contentText?: string | null
} = {}) {
  await getDb().insert(newsItems).values({
    sourceId,
    externalId: randomUUID(),
    title: '標題',
    url: `https://example.invalid/${randomUUID()}`,
    fetchedAt,
    publishedAt: over.publishedAt ?? null,
    contentText: over.contentText ?? '一段真的內文，講了標題沒有的事',
    contentSource: over.contentSource ?? 'rss-excerpt',
  })
}

describe('getNewsHealthRaw (real DB)', () => {
  beforeEach(cleanup)
  afterEach(cleanup)
  afterAll(async () => {
    await closeDb()
  })

  it('窗內的則數帶齊判定欄位；窗外的不回，但仍計入 totalItems', async () => {
    const src = await seedSource('test-nhealth-a')
    await seedItem(src, new Date(NOW.getTime() - DAY_MS), {
      publishedAt: new Date(NOW.getTime() - 2 * DAY_MS),
      contentSource: 'scrape',
    })
    await seedItem(src, new Date(NOW.getTime() - 30 * DAY_MS))

    const raw = await getNewsHealthRaw(new Date(NOW.getTime() - 7 * DAY_MS))
    const mineItems = raw.items.filter(i => i.slug === 'test-nhealth-a')
    expect(mineItems).toHaveLength(1)
    expect(mineItems[0]?.contentSource).toBe('scrape')
    expect(mineItems[0]?.publishedAt?.toISOString()).toBe(new Date(NOW.getTime() - 2 * DAY_MS).toISOString())
    expect(mineItems[0]?.title).toBe('標題')
    expect(raw.sources.find(s => s.slug === 'test-nhealth-a')?.totalItems).toBe(2)
  })

  // ★ 停用來源刻意也回：seed 只做 upsert，把設定從 SEED 刪掉不會讓 DB 那列停用——
  // 「有列、停用、零則」正是要看見的狀態之一。
  it('停用來源與零則來源都要出現，且 totalItems 是 0 不是缺列', async () => {
    await seedSource('test-nhealth-off', false)
    await seedSource('test-nhealth-empty')

    const raw = await getNewsHealthRaw(new Date(NOW.getTime() - 7 * DAY_MS))
    const off = raw.sources.find(s => s.slug === 'test-nhealth-off')
    const empty = raw.sources.find(s => s.slug === 'test-nhealth-empty')
    expect(off?.isActive).toBe(false)
    expect(off?.totalItems).toBe(0)
    expect(empty?.totalItems).toBe(0)
    expect(empty?.rssUrl).toBe('https://example.invalid/feed')
  })

  it('publishedAt 可為 null（RSS 沒給 pubDate 的來源）', async () => {
    const src = await seedSource('test-nhealth-nopub')
    await seedItem(src, new Date(NOW.getTime() - DAY_MS), { publishedAt: null })

    const raw = await getNewsHealthRaw(new Date(NOW.getTime() - 7 * DAY_MS))
    expect(raw.items.find(i => i.slug === 'test-nhealth-nopub')?.publishedAt).toBeNull()
  })
})
