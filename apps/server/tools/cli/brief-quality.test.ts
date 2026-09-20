import type { MarketBrief } from '@suanomics/shared'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as articlesRepo from '@suanomics/db/repos/articles-repo'
import * as newsRepo from '@suanomics/db/repos/news-repo'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as context from '../../src/market-data/context.js'
import { buildSourceBase } from './brief-quality.js'

vi.mock('@suanomics/db/repos/news-repo')
vi.mock('@suanomics/db/repos/articles-repo')
vi.mock('../../src/market-data/context.js')

// buildSourceBase / resolveDateSourceBase 是接線層（哪些 url 送去哪張表、
// 怎麼跨表去重、摘要數字怎麼算）——repo 那層（getExternalArticlesByUrls 本身）已有真
// DB 測試守著，這裡只補接線的零覆蓋（複查時發現的缺口）。
function makeBrief(overrides: {
  newsTitlesById?: Record<string, string>
  citations?: MarketBrief['citations']
}): MarketBrief {
  return {
    headline: 'h',
    summary: 's',
    relatedNews: [],
    affectedIndustries: [],
    relatedETFs: [],
    reasoningChain: ['r1'],
    citations: overrides.citations ?? [],
    disclaimer: '本分析僅供參考、非投資建議、實際投資請諮詢專業人士',
    newsTitlesById: overrides.newsTitlesById,
  } as unknown as MarketBrief
}

describe('buildSourceBase / resolveDateSourceBase', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(newsRepo.getNewsItemsByIds).mockResolvedValue([] as never)
    vi.mocked(newsRepo.getNewsItemsByUrls).mockResolvedValue([] as never)
    vi.mocked(newsRepo.getDailyBriefByDate).mockResolvedValue(null)
    vi.mocked(articlesRepo.getExternalArticlesByUrls).mockResolvedValue([] as never)
    vi.mocked(context.loadMarketContext).mockResolvedValue({ snapshotBlock: null } as never)
  })

  it('corpus 只查 news 未命中的 url、不是全部 citation url（也不是空陣列）', async () => {
    const briefA = makeBrief({
      citations: [
        { url: 'https://news-hit.example/1', title: 'c1', quote: 'q1' },
        { url: 'https://corpus-hit.example/2', title: 'c2', quote: 'q2' },
        { url: 'https://miss.example/3', title: 'c3', quote: 'q3' },
      ],
    })
    const briefB = makeBrief({})

    vi.mocked(newsRepo.getNewsItemsByUrls).mockImplementation(async urls =>
      urls
        .filter(u => u === 'https://news-hit.example/1')
        .map(u => ({ id: 501, title: 'News Hit', url: u, contentText: 'news hit body' })) as never)

    await buildSourceBase({ briefA, briefB, date: '2026-06-12' })

    expect(articlesRepo.getExternalArticlesByUrls).toHaveBeenCalledWith([
      'https://corpus-hit.example/2',
      'https://miss.example/3',
    ])
  })

  it('同一 url 同時被 getNewsItemsByIds 與 getNewsItemsByUrls 回傳（同 id）：sources 只出現一次', async () => {
    const briefA = makeBrief({
      newsTitlesById: { 10: 'Dup News' },
      citations: [{ url: 'https://dup.example/x', title: 'd', quote: 'q' }],
    })
    const briefB = makeBrief({})
    const dupRow = { id: 10, title: 'Dup News', url: 'https://dup.example/x', contentText: 'dup body' }
    vi.mocked(newsRepo.getNewsItemsByIds).mockResolvedValue([dupRow] as never)
    vi.mocked(newsRepo.getNewsItemsByUrls).mockResolvedValue([dupRow] as never)

    const result = await buildSourceBase({ briefA, briefB, date: '2026-06-12' })

    expect(result.sources).toEqual([{ title: 'Dup News', text: 'dup body' }])
  })

  it('corpus 回一則 url 與 news（getNewsItemsByIds）重複：只算一次', async () => {
    const briefA = makeBrief({
      newsTitlesById: { 12: 'News Twelve' },
      citations: [{ url: 'https://need-corpus.example/z', title: 'nc', quote: 'q' }],
    })
    const briefB = makeBrief({})
    vi.mocked(newsRepo.getNewsItemsByIds).mockResolvedValue([
      { id: 12, title: 'News Twelve', url: 'https://both.example/y', contentText: 'twelve body' },
    ] as never)
    // corpus 回兩則：一則是真的新資料（z），一則 url 與 news 那側（y）重複——
    // 後者要被去重掉，即使 corpus 那次查詢本來就不該問到它。
    vi.mocked(articlesRepo.getExternalArticlesByUrls).mockResolvedValue([
      { id: 'uuid-1', title: 'Corpus NC', url: 'https://need-corpus.example/z', text: 'corpus nc body' },
      { id: 'uuid-2', title: 'Corpus Y Duplicate', url: 'https://both.example/y', text: 'should be dropped' },
    ] as never)

    const result = await buildSourceBase({ briefA, briefB, date: '2026-06-12' })

    expect(result.sources).toEqual([
      { title: 'News Twelve', text: 'twelve body' },
      { title: 'Corpus NC', text: 'corpus nc body' },
    ])
  })

  it('summary 的四個數字與未命中 console.warn 訊息與 fixture 一致', async () => {
    const u1 = 'https://s/u1'
    const u2 = 'https://s/u2'
    const u3 = 'https://s/u3'
    const u4 = 'https://s/u4'
    const briefA = makeBrief({
      newsTitlesById: { 21: 'News21', 22: 'News22' },
      citations: [
        { url: u1, title: 'c1', quote: 'q1' },
        { url: u2, title: 'c2', quote: 'q2' },
        { url: u3, title: 'c3', quote: 'q3' },
        { url: u4, title: 'c4', quote: 'q4' },
      ],
    })
    const briefB = makeBrief({})

    const idDb = new Map([
      [21, { id: 21, title: 'News21', url: 'https://s/21', contentText: 'b21' }],
      [22, { id: 22, title: 'News22', url: 'https://s/22', contentText: 'b22' }],
      [41, { id: 41, title: 'Daily41', url: 'https://s/41', contentText: 'b41' }],
    ])
    vi.mocked(newsRepo.getNewsItemsByIds).mockImplementation(async ids =>
      ids.map(id => idDb.get(id)).filter((r): r is NonNullable<typeof r> => r !== undefined) as never)
    vi.mocked(newsRepo.getNewsItemsByUrls).mockImplementation(async urls =>
      urls
        .filter(u => u === u1 || u === u2)
        .map(u => (u === u1
          ? { id: 31, title: 'U1', url: u, contentText: 'bu1' }
          : { id: 32, title: 'U2', url: u, contentText: 'bu2' })) as never)
    vi.mocked(articlesRepo.getExternalArticlesByUrls).mockResolvedValue([
      { id: 'uuid-u3', title: 'U3corpus', url: u3, text: 'bu3' },
    ] as never)
    vi.mocked(newsRepo.getDailyBriefByDate).mockResolvedValue({ selectedNewsIds: [21, 41] } as never)
    vi.mocked(context.loadMarketContext).mockResolvedValue({ snapshotBlock: '## 市場數據\n- TAIEX：45397' } as never)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const result = await buildSourceBase({ briefA, briefB, date: '2026-06-12' })

    expect(result.summary).toBe(
      '[brief-quality] 事實底本：新聞 6 則（brief 引用 5：id 命中 2 ＋ citation URL 4 之中 news 2／corpus 1、未命中 1；當日選稿 1）'
      + '＋ 市場快照 1 則（as-of 未重建、可能含報告日之後的資料）',
    )
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('citation URL 有 1 筆'), [u4])
  })

  // 原版 brief 有 dataFreshness 時，快照的 as-of 要重建、且要傳進 loadMarketContext。
  // 這是接線層唯一驗到「brief-quality 真的把 seriesAsOf 遞下去」的測試——漏接時
  // loadMarketContext 只會收到 { reportDate }，這條斷言會抓到。
  it('原版 brief 有 dataFreshness：seriesAsOf 傳進 loadMarketContext、摘要標「已重建」', async () => {
    const briefA = makeBrief({})
    const briefB = makeBrief({})
    vi.mocked(newsRepo.getDailyBriefByDate).mockResolvedValue({
      selectedNewsIds: [],
      briefJson: {
        dataFreshness: [
          { seriesId: 'taiex-close', expectedAsOf: '2026-08-24', actualAsOf: '2026-08-24', lagCycles: 0, state: 'fresh' },
        ],
      },
    } as never)
    vi.mocked(context.loadMarketContext).mockResolvedValue({ snapshotBlock: '## 市場數據\n- TAIEX：45397' } as never)

    const result = await buildSourceBase({ briefA, briefB, date: '2026-08-24' })

    expect(context.loadMarketContext).toHaveBeenCalledWith({
      reportDate: '2026-08-24',
      seriesAsOf: { 'taiex-close': '2026-08-24' },
    })
    expect(result.summary).toContain('as-of 重建自原版 brief')
  })

  describe('--sources / --date 路徑選擇', () => {
    let sourcesDir: string
    let sourcesPath: string

    beforeAll(() => {
      sourcesDir = mkdtempSync(join(tmpdir(), 'brief-quality-test-'))
      sourcesPath = join(sourcesDir, 'sources.json')
      writeFileSync(sourcesPath, JSON.stringify([
        { title: 'File News 1', text: 'body 1' },
        { title: 'File News 2', text: 'body 2' },
      ]), 'utf8')
    })

    afterAll(() => {
      rmSync(sourcesDir, { recursive: true, force: true })
    })

    it('--sources only（不給 date）：不呼叫任何 repo 函式、不加快照', async () => {
      const briefA = makeBrief({})
      const briefB = makeBrief({})

      const result = await buildSourceBase({ briefA, briefB, sourcesPath })

      expect(newsRepo.getNewsItemsByIds).not.toHaveBeenCalled()
      expect(newsRepo.getNewsItemsByUrls).not.toHaveBeenCalled()
      expect(articlesRepo.getExternalArticlesByUrls).not.toHaveBeenCalled()
      expect(context.loadMarketContext).not.toHaveBeenCalled()
      expect(result.sources).toEqual([
        { title: 'File News 1', text: 'body 1' },
        { title: 'File News 2', text: 'body 2' },
      ])
      expect(result.summary).toBe('[brief-quality] 事實底本：新聞 2 則（--sources 檔案）')
    })

    it('--sources ＋ --date：新聞來自檔案、快照仍附加在最後', async () => {
      const briefA = makeBrief({})
      const briefB = makeBrief({})
      vi.mocked(context.loadMarketContext).mockResolvedValue({ snapshotBlock: '## 市場數據\n- TAIEX：45397' } as never)

      const result = await buildSourceBase({ briefA, briefB, date: '2026-06-12', sourcesPath })

      expect(newsRepo.getNewsItemsByIds).not.toHaveBeenCalled()
      expect(newsRepo.getNewsItemsByUrls).not.toHaveBeenCalled()
      expect(articlesRepo.getExternalArticlesByUrls).not.toHaveBeenCalled()
      expect(context.loadMarketContext).toHaveBeenCalledWith({ reportDate: '2026-06-12' })
      expect(result.sources).toEqual([
        { title: 'File News 1', text: 'body 1' },
        { title: 'File News 2', text: 'body 2' },
        { title: '市場數據快照（2026-06-12）', text: '## 市場數據\n- TAIEX：45397' },
      ])
    })

    // 驗收 finding：as-of 重建要查 daily_briefs，而這條路的新聞底本來自檔案、
    // 本來不碰 DB。查詢放在 try 外時 DB 一掛就讓整個 buildSourceBase 拋、整次比較作廢；
    // 舊行為是快照降級成「0 則（載入失敗）」照常比完，這條守住那個降級。
    it('--sources ＋ --date、as-of 查詢打不到 DB：快照降級、底本仍然回得來', async () => {
      const briefA = makeBrief({})
      const briefB = makeBrief({})
      vi.mocked(newsRepo.getDailyBriefByDate).mockRejectedValue(new Error('Failed query: select ... from "daily_briefs"'))

      const result = await buildSourceBase({ briefA, briefB, date: '2026-06-12', sourcesPath })

      expect(result.sources).toEqual([
        { title: 'File News 1', text: 'body 1' },
        { title: 'File News 2', text: 'body 2' },
      ])
      expect(result.summary).toBe('[brief-quality] 事實底本：新聞 2 則（--sources 檔案）＋ 市場快照 0 則（載入失敗）')
    })
  })
})
