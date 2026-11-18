import { describe, expect, it, vi } from 'vitest'
import { runCorpusRefresh } from './corpus-worker.js'

// body 沒有超出標題的文章不 enrich。判準見 @suanomics/shared 的 enrichable.ts。
// 這一組測的是「接線對不對」——判準本身的邊界在 enrichable.test.ts。
interface EnricherResult { failed: boolean, data: { contentSummary: string, entities: Array<{ kind: string, name: string, confidence: number }>, topicTags: string[] } | null, model?: string, costUsd?: number }
interface InsertArg { title: string, url: string, contentSummary: string | null, llmModel: string | null, llmCostUsd: number | null, entities: unknown[], topicTags: string[] }

const GOOGLE_NEWS_EXCERPT = '<a href="https://news.google.com/rss/articles/CBMivwFBVV95cUx?oc=5" target="_blank">Trump backs US minerals projects</a>&nbsp;&nbsp;<font color="#6f6f6f">Reuters</font>'

function deps(entries: Array<{ url: string, title: string, excerpt: string | null }>) {
  const enricher = vi.fn<() => Promise<EnricherResult>>(async () => ({
    failed: false,
    data: { contentSummary: 'real summary', entities: [{ kind: 'company', name: 'X', confidence: 0.9 }], topicTags: ['T'] },
    model: 'm',
    costUsd: 0.001,
  }))
  const inserted: InsertArg[] = []
  return {
    enricher,
    inserted,
    listSources: async () => [{ id: 's1', slug: 'reuters-biz', kind: 'rss' as const, config: { feedUrl: 'https://news.google.com/rss/search?q=x' } }],
    dispatcher: vi.fn(async () => entries.map((e, i) => ({ externalId: `e${i}`, url: e.url, title: e.title, publishedAt: null, excerpt: e.excerpt }))),
    repo: {
      findEnrichmentByContentHash: vi.fn(async () => null),
      isDuplicateUrl: vi.fn(async () => false),
      insertArticle: vi.fn(async (a: InsertArg) => {
        inserted.push(a)
        return 'aid'
      }),
    },
  }
}

describe('body 只有標題就不 enrich', () => {
  it('google News 錨點 excerpt → 不呼叫 enricher', async () => {
    const d = deps([{ url: 'https://news.google.com/rss/articles/x', title: 'Trump backs US minerals projects - Reuters', excerpt: GOOGLE_NEWS_EXCERPT }])
    const r = await runCorpusRefresh({ payload: {}, ...d })
    expect(d.enricher).not.toHaveBeenCalled()
    expect(r.notEnrichableCount).toBe(1)
  })

  it('excerpt 逐字等於 title（Fed press_monetary 的形狀）→ 不呼叫 enricher', async () => {
    const t = 'Minutes of the Federal Open Market Committee, July 28-29, 2026'
    const d = deps([{ url: 'https://www.federalreserve.gov/x.htm', title: t, excerpt: t }])
    const r = await runCorpusRefresh({ payload: {}, ...d })
    expect(d.enricher).not.toHaveBeenCalled()
    expect(r.notEnrichableCount).toBe(1)
  })

  it('★ 仍然入庫，且 title / url 保留——降級是不 enrich，不是不收', async () => {
    const d = deps([{ url: 'https://www.federalreserve.gov/x.htm', title: 'T', excerpt: 'T' }])
    const r = await runCorpusRefresh({ payload: {}, ...d })
    expect(r.insertedCount).toBe(1)
    expect(d.inserted[0]?.title).toBe('T')
    expect(d.inserted[0]?.url).toBe('https://www.federalreserve.gov/x.htm')
  })

  it('★ 不 enrich 的文章不得留下任何 LLM 衍生欄位或記帳', async () => {
    const d = deps([{ url: 'https://www.federalreserve.gov/x.htm', title: 'T', excerpt: 'T' }])
    await runCorpusRefresh({ payload: {}, ...d })
    const a = d.inserted[0]
    expect(a?.contentSummary).toBeNull()
    expect(a?.entities).toEqual([])
    expect(a?.topicTags).toEqual([])
    expect(a?.llmModel).toBeNull()
    expect(a?.llmCostUsd).toBeNull()
  })

  it('★ 也不查 enrichment 快取——查了就可能拿到別人的摘要掛上來', async () => {
    const d = deps([{ url: 'https://www.federalreserve.gov/x.htm', title: 'T', excerpt: 'T' }])
    await runCorpusRefresh({ payload: {}, ...d })
    expect(d.repo.findEnrichmentByContentHash).not.toHaveBeenCalled()
  })

  it('有真本文的文章照常 enrich（不要一竿子打翻）', async () => {
    const d = deps([{ url: 'https://news.ltn.com.tw/a', title: '央行升息一碼', excerpt: '〔財經頻道〕央行今日召開理監事會議，決議升息一碼，理由是通膨壓力未解。' }])
    const r = await runCorpusRefresh({ payload: {}, ...d })
    expect(d.enricher).toHaveBeenCalledTimes(1)
    expect(r.notEnrichableCount).toBe(0)
    expect(d.inserted[0]?.contentSummary).toBe('real summary')
  })

  it('同一批混合時逐篇判定，不是整個來源一起降級', async () => {
    const d = deps([
      { url: 'https://x/1', title: 'T1', excerpt: 'T1' },
      { url: 'https://x/2', title: 'T2', excerpt: '這是一段真的內文摘要、資訊量明顯超出標題。' },
    ])
    const r = await runCorpusRefresh({ payload: {}, ...d })
    expect(r.notEnrichableCount).toBe(1)
    expect(d.enricher).toHaveBeenCalledTimes(1)
  })
})
