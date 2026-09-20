import * as newsRepo from '@suanomics/db/repos/news-repo'
import * as storylinesRepo from '@suanomics/db/repos/storylines-repo'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as editorMod from '../../agents/editor.js'
import * as orchestratorMod from '../../agents/orchestrator.js'
import * as marketContextMod from '../../market-data/context.js'
import { generateDailyBrief } from './brief-generate.js'

vi.mock('@suanomics/db/repos/news-repo')
vi.mock('@suanomics/db/repos/storylines-repo')
vi.mock('../../agents/editor.js')
vi.mock('../../agents/orchestrator.js')
vi.mock('../../market-data/context.js')

function noop(): void {}

// editor 選稿（selectNewsViaEditor）自己另外呼叫一次 loadMarketContext，
// 與 runDailyBrief 內部那次是兩個獨立的接線點（曾被列為本次最容易漏的地方）——
// orchestrator.test.ts 只守得到 runDailyBrief 那次，
// 這支測試專門守 editor 這次，漏接時 editor 會拿著仍會漂移的市場快照做選稿判斷。
describe('generateDailyBrief（editor 端 loadMarketContext 接線）', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(newsRepo.getRelevanceCandidates).mockResolvedValue([])
    vi.mocked(newsRepo.getRecentBriefSummaries).mockResolvedValue([])
    vi.mocked(newsRepo.selectNewsForBrief).mockResolvedValue([
      { id: 1, title: 'T1', url: 'https://x/1', text: 'body' },
    ])
    vi.mocked(storylinesRepo.getOpenStorylines).mockResolvedValue([])
    vi.mocked(editorMod.callEditor).mockResolvedValue({
      selection: null,
      storyline: { storylineTouches: [], resolveStorylines: [], newStorylines: [] },
      schemaDroppedEntries: 0,
    })
    vi.mocked(marketContextMod.loadMarketContext).mockResolvedValue({
      snapshotBlock: null,
      calendarBlock: null,
      officialBlock: null,
      taiexCloseDate: null,
      dataFreshness: [],
      calendarEvents: [],
      citableSeries: [],
      seriesAnchors: [],
    })
    vi.mocked(orchestratorMod.runDailyBrief).mockResolvedValue({
      headline: 'h',
      summary: 's',
      relatedNews: [],
      affectedIndustries: [],
      relatedETFs: [],
      reasoningChain: ['r1', 'r2'],
      citations: [{ url: 'https://x/1', title: 't', quote: 'q' }],
      disclaimer: '本分析僅供參考、非投資建議、實際投資請諮詢專業人士',
    } as never)
  })

  it('opts.seriesAsOf 傳入時，editor 的 loadMarketContext 呼叫要帶 seriesAsOf', async () => {
    await generateDailyBrief('2026-08-24', noop, { seriesAsOf: { 'taiex-close': '2026-08-24' } })

    expect(marketContextMod.loadMarketContext).toHaveBeenCalledWith({
      reportDate: '2026-08-24',
      seriesAsOf: { 'taiex-close': '2026-08-24' },
    })
  })

  // processBriefJob 的正常路徑（沒有 opts）：不能憑空冒出 seriesAsOf key，
  // 否則 loadSnapshot 的 `in` 判斷會誤判成「有覆寫」。
  it('沒有 opts 時，editor 的 loadMarketContext 呼叫不帶 seriesAsOf key', async () => {
    await generateDailyBrief('2026-08-24', noop)

    expect(marketContextMod.loadMarketContext).toHaveBeenCalledWith({ reportDate: '2026-08-24' })
  })
})
