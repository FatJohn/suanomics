import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runNewsRefresh } from './refresh.js'

vi.mock('@suanomics/db/repos/news-repo')
vi.mock('../external/rss-fetcher.js')
vi.mock('../external/scraper.js')
vi.mock('./categorize.js')
vi.mock('./tag.js')

describe('runNewsRefresh', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns 0 inserted when no sources are active', async () => {
    const repo = await import('@suanomics/db/repos/news-repo')
    vi.mocked(repo.getActiveSources).mockResolvedValue([])
    const result = await runNewsRefresh()
    expect(result.sourcesProcessed).toBe(0)
    expect(result.totalInserted).toBe(0)
    expect(result.sourcesFailed).toBe(0)
    expect(result.perSource).toEqual([])
    // 直接列出完整鍵集合：多一個或少一個欄位都要讓這條紅。
    expect(Object.keys(result).sort()).toEqual(['perSource', 'sourcesFailed', 'sourcesProcessed', 'totalInserted'])
  })
})

// 呼叫端證明：scrapeArticle 的三種結果（有正文／成功但沒正文／呼叫失敗）
// 要走到三條不同的分支。改之前三者都是 null，呼叫端只有一個 `if (text)`，
// 「這篇沒有正文」與「這篇根本沒抓到」完全同型。
describe('runNewsRefresh 對 scrape 結果的分流', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  async function setupOneSourceWithTwoItems(): Promise<{
    repo: typeof import('@suanomics/db/repos/news-repo')
    scraper: typeof import('../external/scraper.js')
  }> {
    const repo = await import('@suanomics/db/repos/news-repo')
    const rss = await import('../external/rss-fetcher.js')
    const scraper = await import('../external/scraper.js')
    vi.mocked(repo.getActiveSources).mockResolvedValue([
      { id: 1, slug: 'demo-source', rssUrl: 'https://feed.example/rss' },
    ] as never)
    vi.mocked(rss.fetchRss).mockResolvedValue('<rss/>')
    vi.mocked(rss.parseRssXml).mockReturnValue([] as never)
    vi.mocked(rss.dedupByExternalId).mockReturnValue([{ externalId: 'e1' }, { externalId: 'e2' }] as never)
    vi.mocked(repo.getExistingExternalIds).mockResolvedValue(new Set())
    vi.mocked(repo.buildUpsertRows).mockReturnValue([] as never)
    vi.mocked(repo.insertNewsItems).mockResolvedValue([11, 12])
    vi.mocked(repo.getNewsItemsByIds).mockResolvedValue([
      { id: 11, url: 'https://news.example/1', title: 't1', contentText: null },
      { id: 12, url: 'https://news.example/2', title: 't2', contentText: null },
    ] as never)
    return { repo, scraper }
  }

  it('有正文 → 寫入；呼叫失敗 → 不寫入、也不讓整個來源算失敗', async () => {
    const { repo, scraper } = await setupOneSourceWithTwoItems()
    vi.mocked(scraper.scrapeArticle).mockImplementation(async (url: string) =>
      url.endsWith('/1')
        ? { ok: true, text: '這是一篇抓得到正文的新聞、長度足夠通過門檻的內容。' }
        : { ok: false, reason: 'http_error', detail: 'HTTP 403' },
    )
    const result = await runNewsRefresh()
    expect(vi.mocked(repo.updateScrapedContent).mock.calls.map(c => c[0])).toEqual([11])
    // scrape 失敗是單篇的事、不該把整個來源標成失敗（那會讓 SLO 誤報來源死掉）
    expect(result.sourcesFailed).toBe(0)
    expect(result.perSource[0]?.failed).toBe(false)
    // 失敗次數要進得了 background_jobs.metadata。perSource 是既有的 metadata
    // 欄位（index.ts 的 makeMetadata），所以掛在這裡不必動 audit 那一層。
    expect(result.perSource[0]?.scrapeFailed).toBe(1)
  })

  it('解析失敗（parse_error）一樣只是單篇的事，不把整個來源標成失敗', async () => {
    // 這條守的是 2026-08-22 驗收抓到的行為倒退：解析拋例外若穿出 scrapeArticle，
    // pMap 的 Promise.all 會整批 reject、撞來源層 catch，於是 RSS 好好的來源被
    // 標成 failed → SLO 假告警。scraper 那邊已把它收成 parse_error（見 scraper.test.ts）。
    const { repo, scraper } = await setupOneSourceWithTwoItems()
    vi.mocked(scraper.scrapeArticle).mockResolvedValue({ ok: false, reason: 'parse_error', detail: 'Maximum call stack size exceeded' })
    const result = await runNewsRefresh()
    expect(repo.updateScrapedContent).not.toHaveBeenCalled()
    expect(result.sourcesFailed).toBe(0)
    expect(result.perSource[0]?.failed).toBe(false)
  })

  it('★ 成功但沒有正文 → 不寫入，而且與「呼叫失敗」走的不是同一條路', async () => {
    const { repo, scraper } = await setupOneSourceWithTwoItems()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(scraper.scrapeArticle).mockImplementation(async (url: string) =>
      url.endsWith('/1')
        ? { ok: true, text: null }
        : { ok: false, reason: 'timeout', detail: 'timeout after 10000ms' },
    )
    const result = await runNewsRefresh()
    expect(repo.updateScrapedContent).not.toHaveBeenCalled()
    // ★ 兩篇都沒寫入，但這是兩種不同的原因——「沒有正文」不能併進「呼叫失敗」的
    // 計數，否則其中一個數字會把另一類情況也算進來，量趨勢時整條線都是假的。
    expect(result.perSource[0]).toMatchObject({ scrapeFailed: 1, scrapeEmpty: 1 })
    // 兩條路各自出聲、前綴不同（`scrape empty:` / `scrape <reason>:`），所以各自的 URL
    // 只會出現在屬於自己的那一行——這就是分得開的可觀測證據
    const lines = warn.mock.calls.map(c => String(c[0]))
    expect(lines.some(l => l.includes('scrape empty') && l.includes('https://news.example/1'))).toBe(true)
    const timeoutLine = lines.find(l => l.includes('timeout'))
    expect(timeoutLine).toBeDefined()
    expect(timeoutLine).not.toContain('/1')
    warn.mockRestore()
  })
})

// ★★ 落地率的分子分母要能直接從 perSource 算出來，不必回 DB 做減法——這裡把四條路徑
// 放進同一個直連來源跑一次，對帳 inserted 拆解成「真的寫入」加上每一類「沒寫入」的
// 計數器，總和要恰好等於原始篇數。Google News 代理已在 feed 層整批跳過（見下一個
// describe），不會走到這裡，所以這裡只用直連網址。
describe('runNewsRefresh 落地率不變量', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('★ inserted 恰好等於寫入次數加上每一類沒寫入的計數器（直連來源）', async () => {
    const repo = await import('@suanomics/db/repos/news-repo')
    const rss = await import('../external/rss-fetcher.js')
    const scraper = await import('../external/scraper.js')
    vi.mocked(repo.getActiveSources).mockResolvedValue([
      { id: 1, slug: 'demo-source', rssUrl: 'https://feed.example/rss' },
    ] as never)
    vi.mocked(rss.fetchRss).mockResolvedValue('<rss/>')
    vi.mocked(rss.parseRssXml).mockReturnValue([] as never)
    vi.mocked(rss.dedupByExternalId).mockReturnValue([{ externalId: 'e1' }] as never)
    vi.mocked(repo.getExistingExternalIds).mockResolvedValue(new Set())
    vi.mocked(repo.buildUpsertRows).mockReturnValue([] as never)
    vi.mocked(repo.insertNewsItems).mockResolvedValue([11, 12, 13, 14])
    // 四則涵蓋四條路徑：落在拒抓清單（ctee）、scrape ok:false、scrape ok:true 但
    // text:null、scrape 有正文。
    vi.mocked(repo.getNewsItemsByIds).mockResolvedValue([
      { id: 11, url: 'https://www.ctee.com.tw/news/1', title: 't1', contentText: null },
      { id: 12, url: 'https://news.example/2', title: 't2', contentText: null },
      { id: 13, url: 'https://news.example/3', title: 't3', contentText: null },
      { id: 14, url: 'https://news.example/4', title: 't4', contentText: null },
    ] as never)
    vi.mocked(scraper.scrapeArticle).mockImplementation(async (url: string) => {
      if (url.endsWith('/2'))
        return { ok: false, reason: 'http_error', detail: 'HTTP 403' }
      if (url.endsWith('/3'))
        return { ok: true, text: null }
      return { ok: true, text: '正文'.repeat(20) }
    })

    const result = await runNewsRefresh()
    const p = result.perSource[0]

    const writtenCount = vi.mocked(repo.updateScrapedContent).mock.calls.length
    const bodyDenied = p?.bodyDenied ?? 0
    const scrapeFailed = p?.scrapeFailed ?? 0
    const scrapeEmpty = p?.scrapeEmpty ?? 0
    expect(result.totalInserted).toBe(writtenCount + bodyDenied + scrapeFailed + scrapeEmpty)
    expect(writtenCount).toBe(1)
    expect(p).toMatchObject({ bodyDenied: 1, scrapeFailed: 1, scrapeEmpty: 1 })
  })
})

// Google News 代理 feed（不論 site: 型或關鍵字型）整批在 feed 層跳過抓正文——
// 抓轉址頁本身拿不到正文（本機 DB 實測 22,271 則、content_source='scrape' 0 則）。
describe('runNewsRefresh 對 Google News 代理 feed 的整批跳過', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  const GN_URL = 'https://news.google.com/rss/articles/CBMiTEST?oc=5'

  async function setupProxySource(rssUrl = 'https://news.google.com/rss/search?q=keyword&hl=zh-TW'): Promise<{
    repo: typeof import('@suanomics/db/repos/news-repo')
    scraper: typeof import('../external/scraper.js')
  }> {
    const repo = await import('@suanomics/db/repos/news-repo')
    const rss = await import('../external/rss-fetcher.js')
    const scraper = await import('../external/scraper.js')
    vi.mocked(repo.getActiveSources).mockResolvedValue([{ id: 1, slug: 'google-news-demo', rssUrl }] as never)
    vi.mocked(rss.fetchRss).mockResolvedValue('<rss/>')
    vi.mocked(rss.parseRssXml).mockReturnValue([] as never)
    vi.mocked(rss.dedupByExternalId).mockReturnValue([{ externalId: 'e1' }] as never)
    vi.mocked(repo.getExistingExternalIds).mockResolvedValue(new Set())
    vi.mocked(repo.buildUpsertRows).mockReturnValue([] as never)
    vi.mocked(repo.insertNewsItems).mockResolvedValue([11])
    vi.mocked(repo.getNewsItemsByIds).mockResolvedValue([
      { id: 11, url: GN_URL, title: 't1', contentText: null },
    ] as never)
    return { repo, scraper }
  }

  it('不限 site: 型，Google News 代理 feed 整批跳過抓正文', async () => {
    const { scraper } = await setupProxySource('https://news.google.com/rss/search?q=keyword&hl=zh-TW')

    const result = await runNewsRefresh()

    expect(scraper.scrapeArticle).not.toHaveBeenCalled()
    expect(result.perSource[0]).toMatchObject({ feedSkipped: 1, bodyDenied: 0 })
    // 列出完整鍵集合：perSource 的欄位是寫進 job metadata 的契約，多一個或少一個都要紅。
    expect(Object.keys(result.perSource[0] ?? {}).sort()).toEqual(
      ['bodyDenied', 'failed', 'feedSkipped', 'inserted', 'scrapeEmpty', 'scrapeFailed', 'slug'],
    )
    expect(result.totalInserted).toBe(1)
  })

  it('直連網址（沒有代理）落在拒抓清單上也一樣不抓', async () => {
    const { repo, scraper } = await setupProxySource('https://feed.ctee.example/rss')
    vi.mocked(repo.getNewsItemsByIds).mockResolvedValue([
      { id: 11, url: 'https://www.ctee.com.tw/news/direct/1', title: 't1', contentText: null },
    ] as never)

    const result = await runNewsRefresh()

    expect(scraper.scrapeArticle).not.toHaveBeenCalled()
    expect(result.perSource[0]).toMatchObject({ bodyDenied: 1, feedSkipped: 0 })
  })
})

// 抓正文途中 throw 時，同一個來源不能在 perSource 出現兩列——按 slug 聚合的讀法
// 遇到重複列，分母怎麼算都不對。
describe('runNewsRefresh 的 perSource 每個來源只有一列', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  async function setupOneSource(): Promise<typeof import('@suanomics/db/repos/news-repo')> {
    const repo = await import('@suanomics/db/repos/news-repo')
    const rss = await import('../external/rss-fetcher.js')
    vi.mocked(repo.getActiveSources).mockResolvedValue([
      { id: 1, slug: 'demo-source', rssUrl: 'https://feed.example/rss' },
    ] as never)
    vi.mocked(rss.fetchRss).mockResolvedValue('<rss/>')
    vi.mocked(rss.parseRssXml).mockReturnValue([] as never)
    vi.mocked(rss.dedupByExternalId).mockReturnValue([{ externalId: 'e1' }] as never)
    vi.mocked(repo.getExistingExternalIds).mockResolvedValue(new Set())
    vi.mocked(repo.buildUpsertRows).mockReturnValue([] as never)
    return repo
  }

  it('插入成功、抓正文途中 throw → 一列，同時帶著真實 inserted 與 failed', async () => {
    const repo = await setupOneSource()
    const scraper = await import('../external/scraper.js')
    vi.mocked(repo.insertNewsItems).mockResolvedValue([11, 12])
    vi.mocked(repo.getNewsItemsByIds).mockResolvedValue([
      { id: 11, url: 'https://news.example/1', title: 't1', contentText: null },
      { id: 12, url: 'https://news.example/2', title: 't2', contentText: null },
    ] as never)
    // 抓正文之後的那一步炸掉（categorize 是被 catch 的、tag 也是，所以挑 scrape 本身
    // 之外會穿出去的：讓 updateScrapedContent throw）
    vi.mocked(scraper.scrapeArticle).mockResolvedValue({ ok: true, text: '正文'.repeat(20) })
    vi.mocked(repo.updateScrapedContent).mockRejectedValue(new Error('db write failed'))

    const result = await runNewsRefresh()

    const rows = result.perSource.filter(p => p.slug === 'demo-source')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ inserted: 2, failed: true })
    expect(result.sourcesFailed).toBe(1)
  })

  it('連新聞都還沒插入就失敗 → 也是一列（inserted 0、failed）', async () => {
    const repo = await setupOneSource()
    vi.mocked(repo.insertNewsItems).mockRejectedValue(new Error('insert failed'))

    const result = await runNewsRefresh()

    expect(result.perSource).toHaveLength(1)
    expect(result.perSource[0]).toMatchObject({ slug: 'demo-source', inserted: 0, failed: true })
  })
})
