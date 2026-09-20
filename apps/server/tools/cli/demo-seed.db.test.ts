import { closeDb, getDb } from '@suanomics/db/client'
import { getActiveSources, getRelevanceCandidates } from '@suanomics/db/repos/news-repo'
import { newsItems, newsSources } from '@suanomics/db/schema'
import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEMO_SOURCE_SLUG, seedDemoNews } from './demo-seed.js'

// 真 DB 整合測試，**刻意不 mock**：這支腳本的整個存在意義就是「灌進去的東西真的能被
// brief:generate 實際會跑的選稿查詢撈到」，mock 掉任一層都驗不到這件事。
//
// ★ 清理鍵 `DEMO_SOURCE_SLUG`（'demo-example'）全 repo 唯一（見本次 rg 檢查輸出）——
//   vitest 平行跑檔案，若撞到別的測試用同一個 slug 做 cleanup 會互刪對方剛 seed
//   的資料，症狀是「單獨跑全綠、一起跑紅**別人**那支」。
//
// ★ `getRelevanceCandidates` 撈的是**全表**、不分 source——CI 是全新遷移的空 DB，
//   但同一輪 `pnpm test` 可能有別的 db test 檔平行插入別的資料，所以底下每個查詢
//   結果都先用 slug 過濾成「屬於我這批」再斷言，不直接信任回傳陣列的長度。
async function cleanup(): Promise<void> {
  const db = getDb()
  const [src] = await db.select({ id: newsSources.id }).from(newsSources).where(eq(newsSources.slug, DEMO_SOURCE_SLUG))
  if (src)
    await db.delete(newsItems).where(eq(newsItems.sourceId, src.id))
  await db.delete(newsSources).where(eq(newsSources.slug, DEMO_SOURCE_SLUG))
}

// 錨在遠離「今天」的日期，理由同 news-health.db.test.ts：避免跟其他 db test 檔
// 湊巧用到相近的 fetchedAt 窗、把彼此的資料算進對方的候選池。
const REPORT_DATE = '2026-01-15'

describe('seedDemoNews (real DB)', () => {
  beforeEach(cleanup)
  afterEach(cleanup)
  afterAll(async () => {
    await closeDb()
  })

  it('8 筆合成新聞都真的進得了 news_items，且掛對來源 slug', async () => {
    const { insertedCount } = await seedDemoNews(REPORT_DATE)
    expect(insertedCount).toBe(8)

    const db = getDb()
    const rows = await db.select({ externalId: newsItems.externalId, slug: newsSources.slug })
      .from(newsItems)
      .innerJoin(newsSources, eq(newsItems.sourceId, newsSources.id))
      .where(eq(newsSources.slug, DEMO_SOURCE_SLUG))
    expect(rows).toHaveLength(8)
    expect(new Set(rows.map(r => r.externalId)).size).toBe(8)
  })

  it('topicTags 正確帶進去（沿用 fixture 的值，不是空陣列或 null）', async () => {
    await seedDemoNews(REPORT_DATE)
    const db = getDb()
    const rows = await db.select({ externalId: newsItems.externalId, topicTags: newsItems.topicTags })
      .from(newsItems)
      .innerJoin(newsSources, eq(newsItems.sourceId, newsSources.id))
      .where(eq(newsSources.slug, DEMO_SOURCE_SLUG))
    const byId = new Map(rows.map(r => [r.externalId, r.topicTags as string[]]))
    expect(byId.get('example-1001')).toEqual(['semiconductor', 'export-data', 'ai-demand', 'earnings'])
    for (const r of rows)
      expect(Array.isArray(r.topicTags) && r.topicTags.length > 0, `externalId=${r.externalId}`).toBe(true)
  })

  it('publishedAt 落在選稿窗內：getRelevanceCandidates(reportDate) 真的撈得到全部 8 筆', async () => {
    await seedDemoNews(REPORT_DATE)
    // 這是 brief:generate 實際會呼叫的同一支 repo 函式（見 apps/server/src/jobs/handlers/brief-generate.ts）。
    // 候選窗卡的是 fetched_at（packages/db/src/repos/news-repo.ts:176-178, 193），
    // seedDemoNews 把 fetchedAt 釘死在 reportDate 00:00Z，理當篤定落在窗內。
    const candidates = await getRelevanceCandidates(REPORT_DATE, 14)
    const mine = candidates.filter(c => c.sourceSlug === DEMO_SOURCE_SLUG)
    expect(mine).toHaveLength(8)
  })

  it('較舊的四筆（1001-1004）publishedAt 落在報告日前一天、較新的四筆（1005-1008）落在報告日當天', async () => {
    await seedDemoNews(REPORT_DATE)
    const candidates = await getRelevanceCandidates(REPORT_DATE, 14)
    const mine = candidates.filter(c => c.sourceSlug === DEMO_SOURCE_SLUG)
    const dayOf = (d: Date | null): string | null => d ? d.toISOString().slice(0, 10) : null

    // externalId 不在 RelevanceCandidate 形狀裡（只有 id/title/url/...），改用 db 直查
    // 拿到 externalId ↔ publishedAt 的對應，跟 mine 的內容互相印證同一批資料。
    const db = getDb()
    const rows = await db.select({ externalId: newsItems.externalId, publishedAt: newsItems.publishedAt })
      .from(newsItems)
      .innerJoin(newsSources, eq(newsItems.sourceId, newsSources.id))
      .where(eq(newsSources.slug, DEMO_SOURCE_SLUG))
    expect(rows).toHaveLength(8)
    expect(mine).toHaveLength(8)

    const older = rows.filter(r => ['example-1001', 'example-1002', 'example-1003', 'example-1004'].includes(r.externalId))
    const newer = rows.filter(r => ['example-1005', 'example-1006', 'example-1007', 'example-1008'].includes(r.externalId))
    expect(older).toHaveLength(4)
    expect(newer).toHaveLength(4)
    for (const r of older)
      expect(dayOf(r.publishedAt), r.externalId).toBe('2026-01-14')
    for (const r of newer)
      expect(dayOf(r.publishedAt), r.externalId).toBe('2026-01-15')
  })

  // ★ 這條釘的是 demo 路徑賴以成立的那個耦合，不是實作細節：
  //   demo 來源刻意 `is_active = false`（否則 `news:refresh` 會把這個不存在的 RSS
  //   當死 feed 每輪抓一次、污染 news:health 的 silent／never 判定），
  //   而選稿的 `getRelevanceCandidates` 目前**沒有**過濾 `is_active`，所以照樣撈得到。
  //   哪天有人在 getRelevanceCandidates 加上 is_active 過濾，demo 會靜默產不出報告——
  //   這條會先紅，並告訴他為什麼。
  it('demo 來源停用（refresh 不會抓它），但選稿仍撈得到它的新聞', async () => {
    await seedDemoNews(REPORT_DATE)
    const active = await getActiveSources()
    expect(active.map(s => s.slug)).not.toContain(DEMO_SOURCE_SLUG)
    const candidates = await getRelevanceCandidates(REPORT_DATE, 14)
    expect(candidates.filter(c => c.sourceSlug === DEMO_SOURCE_SLUG)).toHaveLength(8)
  })

  it('重跑 idempotent：跑兩次仍是 8 筆，不會重複插入', async () => {
    await seedDemoNews(REPORT_DATE)
    const second = await seedDemoNews(REPORT_DATE)
    expect(second.insertedCount).toBe(8) // buildRows 本身固定回 8 筆（呼叫端語意），不代表 DB 真的多了 8 筆

    const db = getDb()
    const rows = await db.select({ externalId: newsItems.externalId })
      .from(newsItems)
      .innerJoin(newsSources, eq(newsItems.sourceId, newsSources.id))
      .where(eq(newsSources.slug, DEMO_SOURCE_SLUG))
    expect(rows).toHaveLength(8)
    expect(new Set(rows.map(r => r.externalId)).size).toBe(8)
  })
})
