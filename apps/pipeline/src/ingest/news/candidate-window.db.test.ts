import { randomUUID } from 'node:crypto'
import { inArray, like } from 'drizzle-orm'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, getDb } from '../../db/client.js'
import { getRelevanceCandidates } from '../../db/repos/news-repo.js'
import { newsItems, newsSources } from '../../db/schema.js'
import { candidateWindowDays } from './candidate-window.js'

// 真 DB：窗的邊界是 fetchedAt 與 timestamptz 的比較，fake 驗不出時區與含不含端點。
// 每日執行在台北 05:00（= 前一天 21:00 UTC），所以「上一個交易日那次執行」抓到的新聞
// fetchedAt 落在上一個交易日的前一天 21:00 UTC。
//
// ★ 清理前綴 `test-closure57-` 全 repo 唯一（挑之前 rg 過）。日期挑 2026-09，避開
//   news-repo.test.ts 用的「今天」與 2026-06 窗，免得互相算進對方的候選。
const PREFIX = 'test-closure57-'

async function cleanup(): Promise<void> {
  const db = getDb()
  const mine = await db.select({ id: newsSources.id }).from(newsSources).where(like(newsSources.slug, `${PREFIX}%`))
  if (mine.length > 0)
    await db.delete(newsItems).where(inArray(newsItems.sourceId, mine.map(r => r.id)))
  await db.delete(newsSources).where(like(newsSources.slug, `${PREFIX}%`))
}

async function seed(fetched: Record<string, string>): Promise<number> {
  const db = getDb()
  const [src] = await db.insert(newsSources).values({
    slug: `${PREFIX}src`,
    displayName: 'closure57',
    rssUrl: 'https://example.invalid/feed',
    isActive: true,
  }).returning({ id: newsSources.id })
  if (!src)
    throw new Error('seed source failed')
  await db.insert(newsItems).values(Object.entries(fetched).map(([title, at]) => ({
    sourceId: src.id,
    externalId: randomUUID(),
    title,
    url: `https://example.invalid/${randomUUID()}`,
    fetchedAt: new Date(at),
    contentSource: 'rss-excerpt' as const,
  })))
  return src.id
}

async function titlesInWindow(briefDate: string): Promise<string[]> {
  const rows = await getRelevanceCandidates(briefDate, candidateWindowDays(briefDate))
  return rows.filter(r => r.sourceSlug.startsWith(PREFIX)).map(r => r.title).sort()
}

describe('休市後第一個交易日的候選窗（real DB）', () => {
  beforeEach(cleanup)
  afterEach(cleanup)
  afterAll(async () => {
    await closeDb()
  })

  it('週五 → 週一（2026-09-14）：最舊到週五那次執行，最新到週一當天結束', async () => {
    await seed({
      'thu-run': '2026-09-09T21:00:00Z', // 週四那次執行，週五報告已涵蓋
      'oldest-edge': '2026-09-10T00:00:00Z', // 窗的下界本身
      'fri-run': '2026-09-10T21:00:00Z', // 上一個交易日（週五）那次執行
      'sat-noon': '2026-09-12T04:00:00Z', // 休市期間（日後若週末也抓新聞）
      'mon-run': '2026-09-13T21:00:00Z', // 本次執行
      'newest-edge': '2026-09-14T23:59:59.999Z', // 窗的上界本身
      'tue-late': '2026-09-15T00:00:00Z', // 報告日之後才抓到
    })
    expect(await titlesInWindow('2026-09-14')).toEqual(['fri-run', 'mon-run', 'newest-edge', 'oldest-edge', 'sat-noon'])
  })

  it('連假前 → 連假後（09-24 → 09-29）：涵蓋中秋到教師節整段', async () => {
    await seed({
      'wed-run': '2026-09-22T21:00:00Z', // 09-23 的執行，09-24 報告前一天
      'thu-run': '2026-09-23T21:00:00Z', // 上一個交易日（09-24）那次執行
      'holiday-mid': '2026-09-26T12:00:00Z',
      'tue-run': '2026-09-28T21:00:00Z',
      'wed-late': '2026-09-30T00:00:00Z',
    })
    expect(await titlesInWindow('2026-09-29')).toEqual(['holiday-mid', 'thu-run', 'tue-run'])
  })
})
