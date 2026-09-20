import { describe, expect, it, vi } from 'vitest'
import { runCorpusRefresh } from './corpus-worker.js'

interface EnrichmentSnapshot { contentSummary: string | null, entities: Array<{ kind: string, name: string, confidence: number }>, topicTags: string[] }
interface EnricherResult { failed: boolean, data: { contentSummary: string, entities: Array<{ kind: string, name: string, confidence: number }>, topicTags: string[] } | null, model?: string, costUsd?: number }
interface InsertArticleArg { llmModel: string | null, llmCostUsd: number | null }

describe('runCorpusRefresh', () => {
  const baseDeps = () => {
    const sources = [
      { id: 's1', slug: 'anue', kind: 'rss' as const, config: { feedUrl: 'https://x.com/feed' } },
    ]
    const dispatcher = vi.fn(async () => [
      { externalId: 'e1', url: 'https://x.com/a', title: 'A', publishedAt: null, excerpt: 'ex' },
      { externalId: 'e2', url: 'https://x.com/b', title: 'B', publishedAt: null, excerpt: 'ex2' },
    ])
    const enricher = vi.fn<() => Promise<EnricherResult>>(async () => ({ failed: false, data: { contentSummary: 's', entities: [{ kind: 'company', name: 'X', confidence: 0.9 }], topicTags: ['T'] } }))
    const repo = {
      findEnrichmentByContentHash: vi.fn<(hash: string) => Promise<EnrichmentSnapshot | null>>(async () => null),
      isDuplicateUrl: vi.fn(async () => false),
      insertArticle: vi.fn(async () => 'aid'),
    }
    const progressReports: number[] = []
    return { sources, dispatcher, enricher, repo, progress: (p: number) => {
      progressReports.push(p)
    }, progressReports }
  }

  it('fetches + enriches + inserts + reports progress', async () => {
    const d = baseDeps()
    const r = await runCorpusRefresh({ payload: {}, ...d, listSources: async () => d.sources })
    expect(r.insertedCount).toBe(2)
    expect(r.skippedCount).toBe(0)
    expect(r.reusedEnrichmentCount).toBe(0)
    expect(d.progressReports[d.progressReports.length - 1]).toBe(100)
  })

  it('skips duplicate url (same source + urlHash)', async () => {
    const d = baseDeps()
    d.repo.isDuplicateUrl = vi.fn(async () => true)
    const r = await runCorpusRefresh({ payload: {}, ...d, listSources: async () => d.sources })
    expect(r.insertedCount).toBe(0)
    expect(r.skippedCount).toBe(2)
    expect(d.enricher).not.toHaveBeenCalled()
  })

  // ★ 釘住 fetchBody 的呼叫位置在**去重之後**。少了這條，把那行搬到 isDuplicateUrl
  //   之前的突變會完全存活（測試全綠），代價是每輪 refresh 對已經抓過的文章重複打外部
  //   服務——TWSE 那個來源是 538 筆、每筆兩次請求。
  it('已經抓過的文章不會為了正文再打一次外部服務', async () => {
    const d = baseDeps()
    const fetchBody = vi.fn(async () => '正文')
    d.dispatcher = vi.fn(async () => [
      { externalId: 'e1', url: 'https://x.com/a', title: 'A', publishedAt: null, excerpt: null, fetchBody },
    ])
    d.repo.isDuplicateUrl = vi.fn(async () => true)

    const r = await runCorpusRefresh({ payload: {}, ...d, listSources: async () => d.sources })

    expect(r.skippedCount).toBe(1)
    expect(fetchBody, '去重命中時不該呼叫 fetchBody').not.toHaveBeenCalled()
  })

  it('沒抓過的文章才會取正文，而且取到的正文會進 enrich', async () => {
    const d = baseDeps()
    const fetchBody = vi.fn(async () => '這是一段真的正文，內容超出標題')
    d.dispatcher = vi.fn(async () => [
      { externalId: 'e1', url: 'https://x.com/a', title: 'A', publishedAt: null, excerpt: null, fetchBody },
    ])

    const r = await runCorpusRefresh({ payload: {}, ...d, listSources: async () => d.sources })

    expect(fetchBody).toHaveBeenCalledTimes(1)
    expect(r.insertedCount).toBe(1)
    // excerpt 是 null、正文靠 fetchBody 補——沒補上的話 hasBodyBeyondTitle 會回 false、
    // 這篇就不會 enrich，等於進了 DB 卻進不了檢索。
    expect(d.enricher).toHaveBeenCalledWith(expect.objectContaining({ body: '這是一段真的正文，內容超出標題' }))
  })

  it('reuses enrichment on content_hash hit', async () => {
    const d = baseDeps()
    d.repo.findEnrichmentByContentHash = vi.fn(async () => ({ contentSummary: 'cached', entities: [], topicTags: [] }))
    const r = await runCorpusRefresh({ payload: {}, ...d, listSources: async () => d.sources })
    expect(r.reusedEnrichmentCount).toBe(2)
    expect(d.enricher).not.toHaveBeenCalled()
  })

  it('enrichment fail → inserts row with NULL summary + marks metadata', async () => {
    const d = baseDeps()
    d.enricher = vi.fn(async () => ({ failed: true, data: null }))
    const r = await runCorpusRefresh({ payload: {}, ...d, listSources: async () => d.sources })
    expect(r.enrichmentFailedCount).toBe(2)
    expect(r.insertedCount).toBe(2)
  })

  // 記帳回寫：llmModel / llmCostUsd 是 enricher 回報的實值（不再是 hardcode 估算）
  it('enricher 回報 model / costUsd → 原值寫進 article', async () => {
    const d = baseDeps()
    d.enricher = vi.fn<() => Promise<EnricherResult>>(async () => ({
      failed: false,
      data: { contentSummary: 's', entities: [], topicTags: [] },
      model: 'gemini-3.5-flash-lite',
      costUsd: 0.00135,
    }))
    await runCorpusRefresh({ payload: {}, ...d, listSources: async () => d.sources })
    const arg = d.repo.insertArticle.mock.calls[0]?.[0] as InsertArticleArg | undefined
    expect(arg?.llmModel).toBe('gemini-3.5-flash-lite')
    expect(arg?.llmCostUsd).toBe(0.00135)
  })

  it('enricher 沒帶記帳欄（或 enrichment 失敗）→ 記 null 而非估算值', async () => {
    const d = baseDeps() // baseDeps 的 enricher 只回 { failed, data }
    await runCorpusRefresh({ payload: {}, ...d, listSources: async () => d.sources })
    const arg = d.repo.insertArticle.mock.calls[0]?.[0] as InsertArticleArg | undefined
    expect(arg?.llmModel).toBeNull()
    expect(arg?.llmCostUsd).toBeNull()
  })

  it('single source fetch error → logs + continues others', async () => {
    const d = baseDeps()
    const sources = [
      { id: 's1', slug: 'bad', kind: 'rss' as const, config: { feedUrl: 'x' } },
      { id: 's2', slug: 'ok', kind: 'rss' as const, config: { feedUrl: 'y' } },
    ]
    const dispatcher = vi.fn(async (src: { id: string }) => {
      if (src.id === 's1')
        throw new Error('fetch failed')
      return [{ externalId: null, url: 'https://x.com/ok', title: 'OK', publishedAt: null, excerpt: null }]
    })
    const r = await runCorpusRefresh({ ...d, dispatcher, listSources: async () => sources, payload: {} })
    expect(r.insertedCount).toBe(1)
    expect(r.failedSources).toEqual(['bad'])
  })

  it('respects payload.sourceSlugs filter', async () => {
    const d = baseDeps()
    const sources = [{ id: 's1', slug: 'anue', kind: 'rss' as const, config: {} }, { id: 's2', slug: 'ctee', kind: 'rss' as const, config: {} }]
    const listSources = vi.fn(async (slugs?: string[]) => slugs ? sources.filter(s => slugs.includes(s.slug)) : sources)
    const r = await runCorpusRefresh({ ...d, payload: { sourceSlugs: ['ctee'] }, listSources })
    expect(listSources).toHaveBeenCalled()
    expect(d.dispatcher).toHaveBeenCalledTimes(1)
    expect(r.insertedCount).toBe(2)
  })

  it('parallelizes source fetch up to concurrency limit', async () => {
    const sources = Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, slug: `src${i}`, kind: 'rss' as const, config: {} }))
    let inflight = 0
    let peakInflight = 0
    const dispatcher = vi.fn(async () => {
      inflight++
      peakInflight = Math.max(peakInflight, inflight)
      // 用 setImmediate 讓其他 worker 有機會 race in、模擬真實 I/O
      await new Promise(r => setImmediate(r))
      await new Promise(r => setImmediate(r))
      inflight--
      return [{ externalId: null, url: 'https://x.com/a', title: 'A', publishedAt: null, excerpt: 'ex' }]
    })
    const enricher = vi.fn<() => Promise<EnricherResult>>(async () => ({ failed: false, data: { contentSummary: 's', entities: [], topicTags: [] } }))
    const repo = {
      findEnrichmentByContentHash: vi.fn<(hash: string) => Promise<EnrichmentSnapshot | null>>(async () => null),
      isDuplicateUrl: vi.fn(async () => false),
      insertArticle: vi.fn(async () => 'aid'),
    }
    const r = await runCorpusRefresh({
      payload: {},
      listSources: async () => sources,
      dispatcher,
      enricher,
      repo,
      concurrency: 2,
    })
    expect(dispatcher).toHaveBeenCalledTimes(6)
    expect(peakInflight).toBe(2)
    expect(r.insertedCount).toBe(6)
  })

  it('concurrency=1 falls back to serial', async () => {
    const sources = Array.from({ length: 3 }, (_, i) => ({ id: `s${i}`, slug: `src${i}`, kind: 'rss' as const, config: {} }))
    let inflight = 0
    let peakInflight = 0
    const dispatcher = vi.fn(async () => {
      inflight++
      peakInflight = Math.max(peakInflight, inflight)
      await new Promise(r => setImmediate(r))
      inflight--
      return []
    })
    const enricher = vi.fn<() => Promise<EnricherResult>>(async () => ({ failed: false, data: { contentSummary: '', entities: [], topicTags: [] } }))
    const repo = {
      findEnrichmentByContentHash: vi.fn<(hash: string) => Promise<EnrichmentSnapshot | null>>(async () => null),
      isDuplicateUrl: vi.fn(async () => false),
      insertArticle: vi.fn(async () => 'aid'),
    }
    await runCorpusRefresh({
      payload: {},
      listSources: async () => sources,
      dispatcher,
      enricher,
      repo,
      concurrency: 1,
    })
    expect(peakInflight).toBe(1)
  })
  // notEnrichableCount 是全來源加總，看不出「某一個來源 100% 不可 enrich」。
  // fsc-news 就是這樣躲過去的——15 篇全部沒 enrich，而總數裡它只是幾百分之十五。
  it('逐來源明細保留 slug 維度', async () => {
    const d = baseDeps()
    const sources = [
      { id: 's1', slug: 'good', kind: 'rss' as const, config: { feedUrl: 'https://x.com/feed' } },
      { id: 's2', slug: 'bad', kind: 'html-selector' as const, config: { listingUrl: 'https://y.com/list' } },
    ]
    d.dispatcher = vi.fn(async (input: { id: string }) => (input.id === 's1'
      ? [{ externalId: null, url: 'https://x.com/a', title: 'A', publishedAt: null, excerpt: '一段真正的內容、超出標題' }]
      : [{ externalId: null, url: 'https://y.com/b', title: 'B', publishedAt: null, excerpt: null }]))

    const r = await runCorpusRefresh({ payload: {}, ...d, listSources: async () => sources, concurrency: 1 })

    expect(r.notEnrichableCount).toBe(1)
    expect(r.perSource.find(x => x.slug === 'bad')).toMatchObject({ slug: 'bad', inserted: 1, notEnrichable: 1 })
    expect(r.perSource.find(x => x.slug === 'good')).toMatchObject({ slug: 'good', inserted: 1, notEnrichable: 0 })
  })

  it('fetch 失敗的來源在逐來源明細裡標得出來', async () => {
    const d = baseDeps()
    d.dispatcher = vi.fn(async () => {
      throw new Error('boom')
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const r = await runCorpusRefresh({ payload: {}, ...d, listSources: async () => d.sources })

    expect(r.failedSources).toEqual(['anue'])
    expect(r.perSource.find(x => x.slug === 'anue')).toMatchObject({ fetchFailed: true, inserted: 0 })
  })
})
