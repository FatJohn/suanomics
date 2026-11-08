import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runIngest } from './run.js'

vi.mock('./news/refresh.js')
vi.mock('./structured.js')
vi.mock('./market-data/refresh.js')
vi.mock('../db/repos/news-repo.js')
vi.mock('../db/repos/source-fetch-repo.js')

const SATURDAY = new Date('2026-11-07T00:00:00Z')
const MONDAY = new Date('2026-11-08T21:00:00Z') // 台北 11-09 週一 05:00

async function mocks(): Promise<{
  news: typeof import('./news/refresh.js')
  structured: typeof import('./structured.js')
  repo: typeof import('../db/repos/news-repo.js')
  market: typeof import('./market-data/refresh.js')
}> {
  const news = await import('./news/refresh.js')
  const structured = await import('./structured.js')
  const repo = await import('../db/repos/news-repo.js')
  const market = await import('./market-data/refresh.js')
  const sourceFetch = await import('../db/repos/source-fetch-repo.js')
  vi.mocked(sourceFetch.getSourceFetchHistory).mockResolvedValue(new Map())
  vi.mocked(news.runNewsRefresh).mockResolvedValue({ sourcesProcessed: 1, sourcesFailed: 0, totalInserted: 2, perSource: [] })
  vi.mocked(structured.refreshTwseOpenapi).mockResolvedValue({ pointsUpserted: 3, companies: [{ code: '2330', name: '台積電' }], topVolume: [{ code: '2317', name: '鴻海' }] })
  vi.mocked(structured.ingestMaterialAnnouncements).mockResolvedValue({ fetched: 5, kept: 1, inserted: 1 })
  vi.mocked(structured.ingestEconCalendar).mockResolvedValue({ manual: 20, fed: 2, upserted: 22 })
  vi.mocked(market.refreshMarketData).mockResolvedValue({ seriesProcessed: 1, pointsUpserted: 1, failures: [] })
  vi.mocked(repo.getRelevanceCandidates).mockResolvedValue([
    { id: 1, title: '台積電擴產', url: 'u', contentText: '內文', category: 'industry', publishedAt: null, fetchedAt: new Date(), sourceSlug: 'cna', topicTags: [] },
  ])
  return { news, structured, repo, market }
}

describe('runIngest', () => {
  beforeEach(() => vi.resetAllMocks())

  it('非交易日直接結束，不抓任何來源', async () => {
    const { news } = await mocks()
    const result = await runIngest({ now: SATURDAY })
    expect(result).toEqual({ status: 'skipped', date: '2026-11-07' })
    expect(news.runNewsRefresh).not.toHaveBeenCalled()
  })

  it('帶 date 時以該日為報告日，不用執行當下的台北日期', async () => {
    const { repo } = await mocks()
    const result = await runIngest({ now: SATURDAY, date: '2026-11-10', force: true })
    expect(result).toMatchObject({ status: 'done', date: '2026-11-10' })
    expect(repo.getRelevanceCandidates).toHaveBeenCalledWith('2026-11-10', 2)
    const sourceFetch = await import('../db/repos/source-fetch-repo.js')
    // 當下的 feed 狀態不代表該報告日，寫進去會竄改連續失敗的歷史。
    expect(sourceFetch.recordSourceFetchResults).not.toHaveBeenCalled()
  })

  it('記錄逐來源狀態，連續失敗達門檻時輸出告警', async () => {
    const { news } = await mocks()
    const sourceFetch = await import('../db/repos/source-fetch-repo.js')
    vi.mocked(news.runNewsRefresh).mockResolvedValue({ sourcesProcessed: 1, sourcesFailed: 1, totalInserted: 0, perSource: [{ slug: 'cna', inserted: 0, failed: true, httpStatus: 403 }] as never })
    vi.mocked(sourceFetch.getSourceFetchHistory).mockResolvedValue(new Map([['cna', [
      { runDate: '2026-11-09', failed: true, httpStatus: 403 },
      { runDate: '2026-11-06', failed: true, httpStatus: 403 },
      { runDate: '2026-11-05', failed: true, httpStatus: 500 },
    ]]]))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await runIngest({ now: MONDAY })
    expect(sourceFetch.recordSourceFetchResults).toHaveBeenCalledWith('2026-11-09', [{ slug: 'cna', failed: true, httpStatus: 403 }])
    expect(warn).toHaveBeenCalledWith('::warning title=新聞來源連續失敗::cna 連續 3 天失敗（HTTP 403）')
    warn.mockRestore()
  })

  it('force 時非交易日也跑（本機驗證用）', async () => {
    const { news } = await mocks()
    await runIngest({ now: SATURDAY, force: true })
    expect(news.runNewsRefresh).toHaveBeenCalled()
  })

  it('交易日依台北日期取候選，並把入選新聞與成交量前段的公司交給重訊過濾', async () => {
    const { repo, structured } = await mocks()
    const result = await runIngest({ now: MONDAY })
    expect(repo.getRelevanceCandidates).toHaveBeenCalledWith('2026-11-09', 2)
    expect(structured.ingestMaterialAnnouncements).toHaveBeenCalledWith(['台積電擴產\n內文'], [{ code: '2330', name: '台積電' }], [{ code: '2317', name: '鴻海' }])
    expect(result).toMatchObject({ status: 'done', date: '2026-11-09', failures: [] })
  })

  it('單一步驟失敗不中斷其他步驟，失敗列在 failures', async () => {
    const { structured } = await mocks()
    vi.mocked(structured.ingestEconCalendar).mockRejectedValue(new Error('boom'))
    const result = await runIngest({ now: MONDAY })
    expect(result).toMatchObject({ status: 'done', failures: ['econ-calendar'] })
  })
})
