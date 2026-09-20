import { randomUUID } from 'node:crypto'
import { closeDb, getDb } from '@suanomics/db/client'
import { newsItems, newsSources } from '@suanomics/db/schema'
import { inArray, like } from 'drizzle-orm'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getNewsSourceActivity } from './news-source-activity.js'

// 真 DB 整合測試。理由同 articles-repo.db.test.ts：這支查詢的窗判定與型別轉換只有真的
// 送到 Postgres 才驗得出來（2026-08-21 那次實際運行時遇到的故障就是 fake 全綠、真 driver 上炸）。
//
// ★ 清理前綴 `test-newssrc-` 全 repo 唯一（vitest 平行跑檔案，撞前綴會互刪對方剛 seed
//   的資料，症狀是「單獨跑全綠、一起跑紅別人那支」）。
const DAY_MS = 86_400_000
// ★ 錨在**遠離「今天」**的日期，不是 new Date()：這些列寫進共用的 news_items，而
// news-repo.test.ts 的 getStratifiedCandidates／selectNewsForBrief 讀的是「整張表在
// 今天往回 N 天的窗內」——不是靠前綴隔離就躲得掉的。兩支平行跑時我的列會被算進它的
// 分層 cap，症狀是**別人那支**紅、而且時好時壞（2026-08-23 實際踩過一次）。
const NOW = new Date('2025-03-15T04:00:00.000Z')

async function cleanup() {
  const db = getDb()
  const mine = await db.select({ id: newsSources.id }).from(newsSources).where(like(newsSources.slug, 'test-newssrc-%'))
  if (mine.length > 0)
    await db.delete(newsItems).where(inArray(newsItems.sourceId, mine.map(r => r.id)))
  await db.delete(newsSources).where(like(newsSources.slug, 'test-newssrc-%'))
}

async function seedSource(slug: string, isActive = true): Promise<number> {
  const [row] = await getDb().insert(newsSources).values({
    slug,
    displayName: slug,
    rssUrl: 'https://example.invalid/feed',
    isActive,
  }).returning({ id: newsSources.id })
  if (!row)
    throw new Error(`seedSource failed: ${slug}`)
  return row.id
}

async function seedItem(sourceId: number, fetchedAt: Date, title: string, contentText: string | null) {
  await getDb().insert(newsItems).values({
    sourceId,
    externalId: randomUUID(),
    title,
    url: `https://example.invalid/${randomUUID()}`,
    fetchedAt,
    contentText,
    contentSource: 'rss-excerpt',
  })
}

describe('getNewsSourceActivity (real DB)', () => {
  beforeEach(cleanup)
  afterEach(cleanup)
  afterAll(async () => {
    await closeDb()
  })

  it('逐來源數窗內/有史以來的則數，只看啟用來源', async () => {
    const active = await seedSource('test-newssrc-active')
    const silent = await seedSource('test-newssrc-silent')
    await seedSource('test-newssrc-never')
    const disabled = await seedSource('test-newssrc-disabled', false)

    await seedItem(active, new Date(NOW.getTime() - DAY_MS), '標題A', '一段真的內文，講了標題沒有的事')
    await seedItem(active, new Date(NOW.getTime() - 30 * DAY_MS), '標題B', '舊的內文')
    await seedItem(silent, new Date(NOW.getTime() - 30 * DAY_MS), '標題C', '舊的內文')
    await seedItem(disabled, new Date(NOW.getTime() - DAY_MS), '標題D', '內文')

    const rows = await getNewsSourceActivity(new Date(NOW.getTime() - 6 * DAY_MS))
    const mine = new Map(rows.filter(r => r.slug.startsWith('test-newssrc-')).map(r => [r.slug, r]))

    expect(mine.get('test-newssrc-active')).toMatchObject({ articlesInWindow: 1, usableInWindow: 1, totalArticles: 2 })
    expect(mine.get('test-newssrc-silent')).toMatchObject({ articlesInWindow: 0, usableInWindow: 0, totalArticles: 1 })
    // LEFT JOIN 才留得住從未產出的來源；改成 INNER 這條會紅
    expect(mine.get('test-newssrc-never')).toMatchObject({ articlesInWindow: 0, usableInWindow: 0, totalArticles: 0 })
    expect(mine.has('test-newssrc-disabled')).toBe(false)
  })

  // ★ 這是整支的重點。用「content_text 非空」當判準的話，下面這個來源會回 usable=3、
  //   完全健康——而它其實一則都沒有超出標題的資訊。實際運行中一整批代理長這樣
  //   （2026-08-23 是 13/18、2026-08-28 換掉三個直連 feed 後是 10/18）。
  it('可用的判準是「超出標題」而不是「非空」——錨點 markup 不算可用', async () => {
    const proxy = await seedSource('test-newssrc-proxy')
    const real = await seedSource('test-newssrc-real')
    const at = new Date(NOW.getTime() - DAY_MS)

    // Google News 的 <description> 形狀：錨點包著標題、後面接發行商
    await seedItem(proxy, at, '台積電法說會釋出樂觀展望 - 經濟日報', '<a href="https://news.google.com/rss/articles/CBMiX0FVX3lx" target="_blank">台積電法說會釋出樂觀展望</a>&nbsp;&nbsp;<font color="#6f6f6f">經濟日報</font>')
    await seedItem(proxy, at, '央行維持利率不變 - 工商時報', '<a href="https://news.google.com/rss/articles/CBMiY0FVX3lx">央行維持利率不變</a>&nbsp;&nbsp;<font color="#6f6f6f">工商時報</font>')
    await seedItem(proxy, at, '只有標題', '只有標題')
    await seedItem(real, at, '央行維持利率不變', '央行今日理監事會決議政策利率維持不變，並下修今年經濟成長率預測至百分之二點八。')

    const rows = await getNewsSourceActivity(new Date(NOW.getTime() - 6 * DAY_MS))
    const mine = new Map(rows.filter(r => r.slug.startsWith('test-newssrc-')).map(r => [r.slug, r]))

    expect(mine.get('test-newssrc-proxy')).toMatchObject({ articlesInWindow: 3, usableInWindow: 0 })
    expect(mine.get('test-newssrc-real')).toMatchObject({ articlesInWindow: 1, usableInWindow: 1 })
  })

  it('content_text 為 null 或空白不算可用', async () => {
    const id = await seedSource('test-newssrc-empty')
    const at = new Date(NOW.getTime() - DAY_MS)
    await seedItem(id, at, '標題', null)
    await seedItem(id, at, '標題', '   \n  ')
    const rows = await getNewsSourceActivity(new Date(NOW.getTime() - 6 * DAY_MS))
    expect(rows.find(r => r.slug === 'test-newssrc-empty')).toMatchObject({ articlesInWindow: 2, usableInWindow: 0 })
  })

  it('窗起點以秒為界、含起點', async () => {
    const id = await seedSource('test-newssrc-boundary')
    const windowStart = new Date('2025-03-09T00:00:00+08:00')
    await seedItem(id, new Date(windowStart.getTime() - 1000), '標題', '窗外的內文，資訊超出標題')
    await seedItem(id, windowStart, '標題', '窗內的內文，資訊超出標題')
    const row = (await getNewsSourceActivity(windowStart)).find(r => r.slug === 'test-newssrc-boundary')
    expect(row).toMatchObject({ articlesInWindow: 1, usableInWindow: 1, totalArticles: 2 })
  })

  it('回的是 number 與可解析的 ISO 字串（監控端常直接用 jq 讀、拿來做時間判斷）', async () => {
    const id = await seedSource('test-newssrc-typed')
    await seedItem(id, new Date(NOW.getTime() - DAY_MS), '標題', '內文超出標題')
    const row = (await getNewsSourceActivity(new Date(NOW.getTime() - 6 * DAY_MS))).find(r => r.slug === 'test-newssrc-typed')
    expect(typeof row?.articlesInWindow).toBe('number')
    expect(typeof row?.usableInWindow).toBe('number')
    expect(typeof row?.totalArticles).toBe('number')
    expect(Number.isNaN(new Date(String(row?.createdAt)).getTime())).toBe(false)
  })
})
