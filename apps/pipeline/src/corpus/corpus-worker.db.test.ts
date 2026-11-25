import { eq, inArray, like } from 'drizzle-orm'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDb, getDb } from '../db/client.js'
import { externalArticles, externalSources } from '../db/schema.js'
import { seedExternalSources } from '../db/seed-external-sources.js'
import { runCorpusRefresh } from './corpus-worker.js'

// 真 DB 測試：純邏輯在 corpus-worker.test.ts（全用 fake）。這支驗 DB 邊界那兩段——
// defaultListSources 讀 external_sources 並驗 config、真 repo 寫入與 (source_id, url_hash) 去重。
// 外部抓取與 LLM 仍用 fake，不打網路、不花錢。
//
// ★ 前綴 corpusit-src- 全 repo 唯一（seedtest-src-、test-src- 已被別的 db test 用掉，
//   vitest 平行跑檔案時共用前綴會互刪資料）。

const SLUG = 'corpusit-src-rss'
const BAD = 'corpusit-src-bad-config'

async function cleanup(): Promise<void> {
  // external_articles 對 source_id 是 ON DELETE CASCADE，刪來源就清掉文章。
  await getDb().delete(externalSources).where(like(externalSources.slug, 'corpusit-src-%'))
}

async function articlesOf(slug: string) {
  const db = getDb()
  const [src] = await db.select({ id: externalSources.id }).from(externalSources).where(eq(externalSources.slug, slug))
  if (!src)
    return []
  return db.select().from(externalArticles).where(inArray(externalArticles.sourceId, [src.id]))
}

const BODY = '中央銀行理監事會決議維持政策利率不變，並調整選擇性信用管制措施，以抑制不動產價格。'

function deps() {
  return {
    payload: { sourceSlugs: [SLUG, BAD] },
    dispatcher: vi.fn(async () => [
      { externalId: 'e1', url: 'https://example.invalid/a?utm_source=x', title: '央行理監事會', publishedAt: null, excerpt: BODY },
      { externalId: 'e2', url: 'https://example.invalid/b', title: '只有標題', publishedAt: null, excerpt: '只有標題' },
    ]),
    enricher: vi.fn(async () => ({
      failed: false,
      data: { contentSummary: '央行維持利率不變', entities: [{ kind: 'macro', name: '利率', confidence: 0.9 }], topicTags: ['monetary-policy'] },
      model: 'claude-haiku-5-5',
      costUsd: 0.001,
    })),
  }
}

describe('runCorpusRefresh (real DB)', () => {
  beforeEach(async () => {
    await cleanup()
    await seedExternalSources([
      { slug: SLUG, displayName: 'corpus it', kind: 'rss', tier: 1, config: { feedUrl: 'https://example.invalid/feed.xml' } },
    ])
    // config 不符 ExternalSourceSeedSchema 的列：要被跳過，不能把壞 config 交給 dispatcher。
    await getDb().insert(externalSources).values({ slug: BAD, displayName: 'bad', kind: 'rss', tier: 1, config: { nope: true } })
  })
  afterEach(cleanup)
  afterAll(async () => {
    await closeDb()
  })

  it('寫入文章、title-only 的不 enrich、壞 config 的來源被跳過', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const d = deps()
    const r = await runCorpusRefresh(d)

    expect(r.perSource.map(s => s.slug)).toEqual([SLUG])
    expect(d.dispatcher).toHaveBeenCalledTimes(1)
    expect(r).toMatchObject({ insertedCount: 2, notEnrichableCount: 1 })

    const rows = await articlesOf(SLUG)
    const enriched = rows.find(a => a.title === '央行理監事會')
    expect(enriched).toMatchObject({ url: 'https://example.invalid/a', contentSummary: '央行維持利率不變', llmModel: 'claude-haiku-5-5', topicTags: ['monetary-policy'] })
    expect(rows.find(a => a.title === '只有標題')).toMatchObject({ contentSummary: null, entities: [], topicTags: [] })
    vi.restoreAllMocks()
  })

  it('第二輪同樣的文章被去重，不再 enrich', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await runCorpusRefresh(deps())
    const d = deps()
    const r = await runCorpusRefresh(d)

    expect(r).toMatchObject({ insertedCount: 0, skippedCount: 2 })
    expect(d.enricher).not.toHaveBeenCalled()
    expect(await articlesOf(SLUG)).toHaveLength(2)
    vi.restoreAllMocks()
  })
})
