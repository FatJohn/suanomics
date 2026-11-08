import { describe, expect, it, vi } from 'vitest'
import { createArticlesRepo, getExternalArticlesByUrls } from './articles-repo.js'

describe('articlesRepo', () => {
  it('findEnrichmentByContentHash 命中時回 summary/entities/topicTags', async () => {
    const fakeDb = {
      query: vi.fn(async () => ([{ contentSummary: 's', entities: [{ kind: 'company', name: 'TSMC', confidence: 0.9 }], topicTags: ['AI'] }])),
    }
    const repo = createArticlesRepo(fakeDb as never)
    const r = await repo.findEnrichmentByContentHash('h1')
    expect(r?.contentSummary).toBe('s')
  })

  it('findEnrichmentByContentHash miss 時回 null', async () => {
    const fakeDb = { query: vi.fn(async () => ([])) }
    const repo = createArticlesRepo(fakeDb as never)
    const r = await repo.findEnrichmentByContentHash('h1')
    expect(r).toBeNull()
  })

  it('insertArticle 正確送出欄位', async () => {
    const insertSpy = vi.fn(async () => [{ id: 'a1' }])
    const fakeDb = { insert: insertSpy }
    const repo = createArticlesRepo(fakeDb as never)
    await repo.insertArticle({
      sourceId: 's1',
      url: 'https://x.com/a',
      urlHash: 'h',
      title: 't',
      rawExcerpt: 'r',
      fullText: null,
      publishedAt: null,
      contentHash: 'ch',
      externalId: null,
      contentSummary: 'sum',
      entities: [],
      topicTags: [],
      llmModel: 'gemini',
      llmCostUsd: 0.001,
    })
    expect(insertSpy).toHaveBeenCalledOnce()
  })
})

describe('getExternalArticlesByUrls', () => {
  // 空陣列必須在 getDb() 之前 early return——本機沒有 Postgres 時這條也要能跑，
  // 若函式先呼叫 getDb() 才短路，這裡會炸連線錯誤而不是回 []。
  it('空陣列直接回 []、不查 DB', async () => {
    expect(await getExternalArticlesByUrls([])).toEqual([])
  })
})
