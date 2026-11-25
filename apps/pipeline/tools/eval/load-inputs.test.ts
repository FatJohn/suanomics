import { describe, expect, it, vi } from 'vitest'

// 只驗 loadQualityFacts 的接線：citations 的 url 要拿去查 external_articles 並併進底本。
// DB 與市場資料都 mock 掉，合併規則本身在 quality-facts.test.ts。
vi.mock('../../src/db/repos/news-repo.js', () => ({
  getNewsItemsByIds: vi.fn(async () => [{ id: 1, title: 'n1', url: 'https://a/1', contentText: '內文1' }]),
  getNewsItemsByUrls: vi.fn(async () => [{ id: 2, title: 'n2', url: 'https://a/2', contentText: null }]),
}))
const corpusRows: Array<{ id: string, title: string, url: string, text: string }> = []
vi.mock('../../src/db/repos/articles-repo.js', () => ({
  getExternalArticlesByUrls: vi.fn(async (urls: string[]) => corpusRows.filter(r => urls.includes(r.url))),
}))
vi.mock('../../src/ingest/market-data/context.js', () => ({
  loadMarketContext: vi.fn(async () => ({ snapshotBlock: 'S', officialBlock: 'O' })),
}))

const { loadQualityFacts } = await import('./load-inputs.js')

function stored(urls: string[]) {
  return { date: '2026-11-17', selectedNewsIds: [1], brief: { citations: urls.map(url => ({ url })), calendarEvents: [], dataFreshness: [] } } as never
}

describe('loadQualityFacts', () => {
  it('未引用 corpus 時，新聞段只有 news_items', async () => {
    corpusRows.length = 0
    const facts = await loadQualityFacts(stored(['https://a/2']))
    expect(facts.news).toEqual([{ title: 'n1', url: 'https://a/1', text: '內文1' }, { title: 'n2', url: 'https://a/2', text: 'n2' }])
  })

  it('引用到的 corpus 文章併進新聞段', async () => {
    corpusRows.splice(0, corpusRows.length, { id: 'c1', title: 'c', url: 'https://cbc/1', text: 'ct' })
    const facts = await loadQualityFacts(stored(['https://a/2', 'https://cbc/1']))
    expect(facts.news).toContainEqual({ title: 'c', url: 'https://cbc/1', text: 'ct' })
  })
})
