import type { RunMetadata } from './orchestrator.js'
import type { SynthesizerOutput } from './synthesizer.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as marketContextMod from '../market-data/context.js'
import * as analystMod from './analyst.js'
import * as decomposerMod from './decomposer.js'
import { buildAliasMap } from './entity-aliases.js'
import { ANALYST_TIER1_FANOUT_CONCURRENCY, DECOMPOSER_FANOUT_CONCURRENCY, MAX_LLM_CALLS_PER_JOB, RETRIEVE_FANOUT_CONCURRENCY } from './fanout-concurrency.js'
import * as narrativeWriterMod from './narrative-writer.js'
import { retrieveForDecomposed, runAnalystOnly, runDailyBrief, runSingleNews, runTier2Fanout, stampTier1 } from './orchestrator.js'
import * as retrieverMod from './retriever.js'
import * as synthesizerMod from './synthesizer.js'
import * as viewpointsMod from './viewpoints-debate.js'

vi.mock('./decomposer.js')
vi.mock('./analyst.js')
vi.mock('./synthesizer.js')
vi.mock('./retriever.js')
vi.mock('./narrative-writer.js')
vi.mock('./viewpoints-debate.js')
// 預設 stub Stage 0 市場 context、避免既有 tests 走真實 DB/FS（warn 雜訊 + 有 DB 時真查）
vi.mock('../market-data/context.js')

// Synthesizer 解耦後只產 prose；citations / disclaimer / cascadeChains 由組裝層補。
// summary='final' 通過 finalizeBriefSafety（sanitize→gate→clamp→parse）不變、既有斷言續用。
const validSynthMock: SynthesizerOutput = {
  headline: 'h',
  summary: 'final',
  relatedNews: [],
  affectedIndustries: [],
  relatedETFs: [],
  reasoningChain: ['r1', 'r2'],
}

describe('runDailyBrief', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    // narrative 是 enhancement、既有 stage 1-4 tests 不 care、預設 stub null
    vi.mocked(narrativeWriterMod.callNarrativeWriter).mockResolvedValue({
      narrative: null,
      audit: { failed: false, retryReason: null, fabricationStripped: 0, claimIdsStripped: 0, claimCitationUrlsDropped: 0, claimCitationSections: 0, claimUnboundNumbers: 0, claimCheckedNumbers: 0, claimIdsTruncated: 0 },
    })
    vi.mocked(marketContextMod.loadMarketContext).mockResolvedValue({ snapshotBlock: null, calendarBlock: null, taiexCloseDate: null, dataFreshness: [{ seriesId: 'us-sox', expectedAsOf: '2026-04-24', actualAsOf: '2026-04-23', lagCycles: 1, state: 'lagging' }], calendarCoverage: [{ category: 'ex-dividend', state: 'out-of-range', sourceEarliestDate: '2026-09-01' }] })
    vi.mocked(viewpointsMod.runViewpointsDebate).mockResolvedValue(null)
  })

  it('should fanout decomposer per news, fanout retriever per hypothesis, batch analyst per news, then synthesize', async () => {
    const news = [
      { id: 'n1', title: 'T1', url: 'https://example.com/n1', text: 'b1' },
      { id: 'n2', title: 'T2', url: 'https://example.com/n2', text: 'b2' },
    ]
    vi.mocked(decomposerMod.callDecomposer).mockResolvedValue({
      primaryEntity: { name: 'X', kind: 'company' },
      topicTags: [],
      cascadeHypotheses: [
        { industry: 'i1', mechanism: 'm1', retrieveQuery: { entities: ['X'], days: 7 } },
      ],
    })
    vi.mocked(retrieverMod.retrieveArticles).mockResolvedValue([])
    vi.mocked(analystMod.callAnalystTier1).mockResolvedValue({
      primaryImpact: 'p',
      cascadeChains: [],
      reasoning: 'r',
    })
    vi.mocked(synthesizerMod.callSynthesizer).mockResolvedValue(validSynthMock)

    const metadata: RunMetadata = { llmCalls: [], totalCostUsd: 0, totalLatencyMs: 0 }
    const brief = await runDailyBrief({ news, date: '2026-04-25', metadata })

    expect(decomposerMod.callDecomposer).toHaveBeenCalledTimes(2)
    expect(retrieverMod.retrieveArticles).toHaveBeenCalledTimes(2) // 1 hypothesis × 2 news
    // ★ 釘的是 threading 的**值**，不只是「有傳」。檢索窗的上界錨在報告日，
    //   而 `runDailyBrief` 底下有兩層會呼叫 retriever（一階經 retrieveForDecomposed、
    //   二階經 runTier2Fanout）。**這一行只涵蓋一階**——這個案例的 tier1Chains 是空的、
    //   二階根本沒跑。三個入口各自的一階＋二階由檔尾的
    //   `報告日 threading 的值` 那組守。
    expect(vi.mocked(retrieverMod.retrieveArticles).mock.calls.map(c => c[0]?.reportDate))
      .toEqual(['2026-04-25', '2026-04-25'])
    expect(analystMod.callAnalystTier1).toHaveBeenCalledTimes(2)
    expect(synthesizerMod.callSynthesizer).toHaveBeenCalledTimes(1)
    expect(brief.summary).toBe('final')
    // 守衛：market context 的 manifest 必須原樣進 brief payload（brief-worker 整包存進
    // brief_json、publication-status 讀的就是它）。少了這行、注入斷掉不會有任何測試紅。
    expect(brief.dataFreshness).toEqual([
      { seriesId: 'us-sox', expectedAsOf: '2026-04-24', actualAsOf: '2026-04-23', lagCycles: 1, state: 'lagging' },
    ])
    // 同一條守衛、同一個理由，給行事曆的來源涵蓋狀態。它比 dataFreshness 更容易在重構中
    // 掉出去：欄位在 brief schema 是 .optional()，所以少了這一跳 tsc **不會**報錯，而症狀
    // （讀者永遠拿不到「不適用」、除權息看起來就是那週沒有）跟這個欄位要修的原病一模一樣。
    expect(brief.calendarCoverage).toEqual([
      { category: 'ex-dividend', state: 'out-of-range', sourceEarliestDate: '2026-09-01' },
    ])
  })

  // seriesAsOf 是補跑歷史日期唯一可靠的 as-of 底本（見 historical-asof.ts 檔頭），
  // 必須原樣轉發給 loadMarketContext——這條測試漏了，orchestrator 這端的接線斷掉
  // 不會有任何測試紅（brief-generate 那端另有測試守 editor 那次呼叫）。
  it('runDailyBrief 收到 seriesAsOf 時要轉發給 loadMarketContext', async () => {
    const news = [
      { id: 'n1', title: 'T1', url: 'https://example.com/n1', text: 'b1' },
      { id: 'n2', title: 'T2', url: 'https://example.com/n2', text: 'b2' },
    ]
    vi.mocked(decomposerMod.callDecomposer).mockResolvedValue({
      primaryEntity: { name: 'X', kind: 'company' },
      topicTags: [],
      cascadeHypotheses: [],
    })
    vi.mocked(retrieverMod.retrieveArticles).mockResolvedValue([])
    vi.mocked(analystMod.callAnalystTier1).mockResolvedValue({
      primaryImpact: 'p',
      cascadeChains: [],
      reasoning: 'r',
    })
    vi.mocked(synthesizerMod.callSynthesizer).mockResolvedValue(validSynthMock)

    const metadata: RunMetadata = { llmCalls: [], totalCostUsd: 0, totalLatencyMs: 0 }
    await runDailyBrief({ news, date: '2026-08-24', metadata, seriesAsOf: { 'taiex-close': '2026-08-24' } })

    expect(marketContextMod.loadMarketContext).toHaveBeenCalledWith({
      reportDate: '2026-08-24',
      seriesAsOf: { 'taiex-close': '2026-08-24' },
    })
  })

  // 沒收到 seriesAsOf（processBriefJob 的正常路徑）時不能憑空冒出一個 undefined key——
  // exactOptionalPropertyTypes 下 `{ seriesAsOf: undefined }` 與「沒有這個 key」是不同的物件、
  // 會讓 loadMarketContext 的 `in` 判斷誤判成「有覆寫」。
  it('runDailyBrief 沒收到 seriesAsOf 時，loadMarketContext 呼叫不帶 seriesAsOf key', async () => {
    const news = [
      { id: 'n1', title: 'T1', url: 'https://example.com/n1', text: 'b1' },
      { id: 'n2', title: 'T2', url: 'https://example.com/n2', text: 'b2' },
    ]
    vi.mocked(decomposerMod.callDecomposer).mockResolvedValue({
      primaryEntity: { name: 'X', kind: 'company' },
      topicTags: [],
      cascadeHypotheses: [],
    })
    vi.mocked(retrieverMod.retrieveArticles).mockResolvedValue([])
    vi.mocked(analystMod.callAnalystTier1).mockResolvedValue({
      primaryImpact: 'p',
      cascadeChains: [],
      reasoning: 'r',
    })
    vi.mocked(synthesizerMod.callSynthesizer).mockResolvedValue(validSynthMock)

    const metadata: RunMetadata = { llmCalls: [], totalCostUsd: 0, totalLatencyMs: 0 }
    await runDailyBrief({ news, date: '2026-08-24', metadata })

    expect(marketContextMod.loadMarketContext).toHaveBeenCalledWith({ reportDate: '2026-08-24' })
  })

  // ledger 落地。少了這兩條，注入斷掉或 claim 撞號都不會有任何測試紅——
  // 而 brief.claimLedger 正是事後把 narrative 的 claimIds 解回 claim 的唯一依據。
  it('把跨新聞的 claim 合併重編號後寫進 brief.claimLedger', async () => {
    const news = [
      { id: 'n1', title: 'T1', url: 'https://example.com/n1', text: 'b1' },
      { id: 'n2', title: 'T2', url: 'https://example.com/n2', text: 'b2' },
    ]
    vi.mocked(decomposerMod.callDecomposer).mockResolvedValue({
      primaryEntity: { name: 'X', kind: 'company' },
      topicTags: [],
      cascadeHypotheses: [],
    })
    vi.mocked(retrieverMod.retrieveArticles).mockResolvedValue([])
    // 兩則新聞各自從 c1 編起（analyst-claims.ts 的實際行為），且第二則與第一則重複一條。
    const mkClaim = (id: string, text: string) => ({
      id,
      kind: 'fact' as const,
      claimType: 'named-number' as const,
      claim: text,
      evidenceRefs: [],
      asOf: '2026-04-25',
      checks: [],
    })
    vi.mocked(analystMod.callAnalystTier1)
      .mockResolvedValueOnce({
        primaryImpact: 'p',
        cascadeChains: [],
        reasoning: 'r',
        claims: [mkClaim('c1', 'A'), mkClaim('c2', 'B')],
      })
      .mockResolvedValueOnce({
        primaryImpact: 'p',
        cascadeChains: [],
        reasoning: 'r',
        claims: [mkClaim('c1', 'A'), mkClaim('c2', 'C')],
      })
    vi.mocked(synthesizerMod.callSynthesizer).mockResolvedValue(validSynthMock)

    const metadata: RunMetadata = { llmCalls: [], totalCostUsd: 0, totalLatencyMs: 0 }
    const brief = await runDailyBrief({ news, date: '2026-04-25', metadata })

    expect(brief.claimLedger?.map(c => [c.id, c.claim])).toEqual([['c1', 'A'], ['c2', 'B'], ['c3', 'C']])
  })

  // 疊加層不得殺掉 brief：mock 沒帶 claims（＝沒走過 Zod 的 .default([])）時仍要產出。
  it('analyst 輸出沒有 claims 時 brief 照常產出、ledger 為空', async () => {
    const news = [
      { id: 'n1', title: 'T1', url: 'https://example.com/n1', text: 'b1' },
      { id: 'n2', title: 'T2', url: 'https://example.com/n2', text: 'b2' },
    ]
    vi.mocked(decomposerMod.callDecomposer).mockResolvedValue({
      primaryEntity: { name: 'X', kind: 'company' },
      topicTags: [],
      cascadeHypotheses: [],
    })
    vi.mocked(retrieverMod.retrieveArticles).mockResolvedValue([])
    vi.mocked(analystMod.callAnalystTier1).mockResolvedValue({ primaryImpact: 'p', cascadeChains: [], reasoning: 'r' })
    vi.mocked(synthesizerMod.callSynthesizer).mockResolvedValue(validSynthMock)

    const metadata: RunMetadata = { llmCalls: [], totalCostUsd: 0, totalLatencyMs: 0 }
    const brief = await runDailyBrief({ news, date: '2026-04-25', metadata })

    expect(brief.summary).toBe('final')
    expect(brief.claimLedger).toEqual([])
  })

  it('passes each news url to the tier1 analyst as newsUrl', async () => {
    const news = [
      { id: 'n1', title: 'T1', url: 'https://example.com/n1', text: 'b1' },
      { id: 'n2', title: 'T2', url: 'https://example.com/n2', text: 'b2' },
    ]
    vi.mocked(decomposerMod.callDecomposer).mockResolvedValue({
      primaryEntity: { name: 'X', kind: 'company' },
      topicTags: [],
      cascadeHypotheses: [],
    })
    vi.mocked(analystMod.callAnalystTier1).mockResolvedValue({
      primaryImpact: 'p',
      cascadeChains: [],
      reasoning: 'r',
    })
    vi.mocked(synthesizerMod.callSynthesizer).mockResolvedValue(validSynthMock)

    const metadata: RunMetadata = { llmCalls: [], totalCostUsd: 0, totalLatencyMs: 0 }
    await runDailyBrief({ news, date: '2026-04-25', metadata })

    expect(vi.mocked(analystMod.callAnalystTier1).mock.calls[0]?.[0]).toMatchObject({
      newsId: 'n1',
      newsUrl: 'https://example.com/n1',
    })
    expect(vi.mocked(analystMod.callAnalystTier1).mock.calls[1]?.[0]).toMatchObject({
      newsId: 'n2',
      newsUrl: 'https://example.com/n2',
    })
  })

  it('should skip news where decomposer fails (partial success)', async () => {
    const news = [
      { id: 'n1', title: 'T1', url: 'https://example.com/n1', text: 'b1' },
      { id: 'n2', title: 'T2', url: 'https://example.com/n2', text: 'b2' },
      { id: 'n3', title: 'T3', url: 'https://example.com/n3', text: 'b3' },
    ]
    vi.mocked(decomposerMod.callDecomposer)
      .mockResolvedValueOnce({ primaryEntity: { name: 'X', kind: 'c' }, topicTags: [], cascadeHypotheses: [] })
      .mockRejectedValueOnce(new Error('Gemini timeout'))
      .mockResolvedValueOnce({ primaryEntity: { name: 'Y', kind: 'c' }, topicTags: [], cascadeHypotheses: [] })
    vi.mocked(analystMod.callAnalystTier1).mockResolvedValue({ primaryImpact: 'p', cascadeChains: [], reasoning: 'r' })
    vi.mocked(synthesizerMod.callSynthesizer).mockResolvedValue(validSynthMock)

    const metadata: RunMetadata = { llmCalls: [], totalCostUsd: 0, totalLatencyMs: 0 }
    const brief = await runDailyBrief({ news, date: '2026-04-25', metadata })
    expect(brief.summary).toBe('final')
    expect(metadata.partialSuccess?.failedNewsIds).toEqual(['n2'])
    expect(analystMod.callAnalystTier1).toHaveBeenCalledTimes(2) // n1 + n3
  })

  it('should abort when fewer than 2 news survive', async () => {
    const news = [
      { id: 'n1', title: 'T1', url: 'https://example.com/n1', text: 'b1' },
      { id: 'n2', title: 'T2', url: 'https://example.com/n2', text: 'b2' },
    ]
    vi.mocked(decomposerMod.callDecomposer).mockRejectedValue(new Error('all fail'))
    const metadata: RunMetadata = { llmCalls: [], totalCostUsd: 0, totalLatencyMs: 0 }
    await expect(runDailyBrief({ news, date: '2026-04-25', metadata })).rejects.toThrow(/insufficient/)
    expect(synthesizerMod.callSynthesizer).not.toHaveBeenCalled()
  })

  it('超過 MAX_LLM_CALLS_PER_JOB 時中止並拋出清楚的錯誤（走既有 onCall 線計數，非另拉一條）', async () => {
    const news = [
      { id: 'n1', title: 'T1', url: 'https://example.com/n1', text: 'b1' },
      { id: 'n2', title: 'T2', url: 'https://example.com/n2', text: 'b2' },
    ]
    const fakeRecord = { agentName: 'decomposer' as const, tokensIn: 1, tokensOut: 1, costUsd: 0, latencyMs: 0, attempts: 1 }
    // 模擬失控迴圈：decomposer 這一次呼叫自己（透過既有 onCallRecord 那條線）灌爆
    // 呼叫數上限，藉此證明計數走的是 onCall、不是另外拉一條計數器。
    vi.mocked(decomposerMod.callDecomposer).mockImplementation(async (p) => {
      for (let i = 0; i < MAX_LLM_CALLS_PER_JOB + 1; i++)
        p.onCallRecord?.(fakeRecord)
      return {
        primaryEntity: { name: 'X', kind: 'company' },
        topicTags: [],
        cascadeHypotheses: [],
      }
    })
    const metadata: RunMetadata = { llmCalls: [], totalCostUsd: 0, totalLatencyMs: 0 }
    await expect(runDailyBrief({ news, date: '2026-04-25', metadata }))
      .rejects
      .toThrow(/LLM call budget exceeded/)
    // 中止乾淨：Stage 1 之後就沒有再進到 Synthesizer
    expect(synthesizerMod.callSynthesizer).not.toHaveBeenCalled()
    // 計數確實來自既有 onCall 線，不是另一個獨立計數器
    expect(metadata.llmCalls.length).toBeGreaterThan(MAX_LLM_CALLS_PER_JOB)
  })

  it('completes brief when loadMarketContext rejects (Stage 0 graceful degrade)', async () => {
    const news = [
      { id: 'n1', title: 'T1', url: 'https://example.com/n1', text: 'b1' },
      { id: 'n2', title: 'T2', url: 'https://example.com/n2', text: 'b2' },
    ]
    vi.mocked(decomposerMod.callDecomposer).mockResolvedValue({
      primaryEntity: { name: 'X', kind: 'company' },
      topicTags: [],
      cascadeHypotheses: [],
    })
    vi.mocked(retrieverMod.retrieveArticles).mockResolvedValue([])
    vi.mocked(analystMod.callAnalystTier1).mockResolvedValue({ primaryImpact: 'p', cascadeChains: [], reasoning: 'r' })
    vi.mocked(synthesizerMod.callSynthesizer).mockResolvedValue(validSynthMock)

    const metadata: RunMetadata = { llmCalls: [], totalCostUsd: 0, totalLatencyMs: 0 }
    const brief = await runDailyBrief({
      news,
      date: '2026-04-25',
      metadata,
      loadMarketContext: async () => { throw new Error('db down') },
    })
    expect(brief.summary).toBe('final')
  })

  it('算市場收盤框架（台股錨）並傳給 analyst/synth/narrative', async () => {
    const news = [
      { id: 'n1', title: 'A', text: 'a', url: 'https://e.com/a', publishedAt: null },
      { id: 'n2', title: 'B', text: 'b', url: 'https://e.com/b', publishedAt: null },
    ]
    vi.mocked(marketContextMod.loadMarketContext).mockResolvedValue({ snapshotBlock: null, calendarBlock: null, taiexCloseDate: '2026-04-24' })
    vi.mocked(decomposerMod.callDecomposer).mockResolvedValue({ primaryEntity: { name: 'X', kind: 'c' }, topicTags: [], cascadeHypotheses: [] })
    vi.mocked(retrieverMod.retrieveArticles).mockResolvedValue([])
    vi.mocked(analystMod.callAnalystTier1).mockResolvedValue({ primaryImpact: 'p', cascadeChains: [], reasoning: 'r' })
    vi.mocked(synthesizerMod.callSynthesizer).mockResolvedValue(validSynthMock)

    const metadata: RunMetadata = { llmCalls: [], totalCostUsd: 0, totalLatencyMs: 0 }
    await runDailyBrief({ news, date: '2026-04-25', metadata })

    const synthArg = vi.mocked(synthesizerMod.callSynthesizer).mock.calls[0]?.[0]?.marketCloseFraming ?? ''
    expect(synthArg).toContain('台股')
    expect(synthArg).toContain('昨日')
    expect(vi.mocked(narrativeWriterMod.callNarrativeWriter).mock.calls[0]?.[0]?.marketCloseFraming).toContain('台股')
    expect(vi.mocked(analystMod.callAnalystTier1).mock.calls[0]?.[0]?.marketCloseFraming).toContain('台股')
  })

  it('should aggregate llmCalls into metadata', async () => {
    const news = [
      { id: 'n1', title: 'T1', url: 'https://example.com/n1', text: 'b1' },
      { id: 'n2', title: 'T2', url: 'https://example.com/n2', text: 'b2' },
    ]
    vi.mocked(decomposerMod.callDecomposer).mockImplementation(async (params) => {
      params.onCallRecord?.({ agentName: 'decomposer', tokensIn: 100, tokensOut: 50, costUsd: 0.001, latencyMs: 1000, attempts: 1 })
      return { primaryEntity: { name: 'X', kind: 'c' }, topicTags: [], cascadeHypotheses: [] }
    })
    vi.mocked(analystMod.callAnalystTier1).mockImplementation(async (params) => {
      params.onCallRecord?.({ agentName: 'analyst-tier1', tokensIn: 200, tokensOut: 80, costUsd: 0.002, latencyMs: 2000, attempts: 1 })
      return { primaryImpact: 'p', cascadeChains: [], reasoning: 'r' }
    })
    vi.mocked(synthesizerMod.callSynthesizer).mockImplementation(async (params) => {
      params.onCallRecord?.({ agentName: 'synthesizer', tokensIn: 500, tokensOut: 300, costUsd: 0.005, latencyMs: 5000, attempts: 1 })
      return validSynthMock
    })
    vi.mocked(retrieverMod.retrieveArticles).mockResolvedValue([])
    const metadata: RunMetadata = { llmCalls: [], totalCostUsd: 0, totalLatencyMs: 0 }
    await runDailyBrief({ news, date: '2026-04-25', metadata })
    expect(metadata.llmCalls).toHaveLength(5) // 2 decomposer + 2 analyst + 1 synthesizer
    expect(metadata.totalCostUsd).toBeCloseTo(0.001 * 2 + 0.002 * 2 + 0.005, 5)
    expect(metadata.totalLatencyMs).toBe(1000 * 2 + 2000 * 2 + 5000)
  })

  // 共用 happy-path mock（decomposer/retriever/analyst/synth）
  function setupHappyMocks() {
    vi.mocked(decomposerMod.callDecomposer).mockResolvedValue({
      primaryEntity: { name: 'X', kind: 'company' },
      topicTags: [],
      cascadeHypotheses: [{ industry: 'i1', mechanism: 'm1', retrieveQuery: { entities: ['X'], days: 7 } }],
    })
    vi.mocked(retrieverMod.retrieveArticles).mockResolvedValue([])
    vi.mocked(analystMod.callAnalystTier1).mockResolvedValue({ primaryImpact: 'p', cascadeChains: [], reasoning: 'r' })
    vi.mocked(synthesizerMod.callSynthesizer).mockResolvedValue(validSynthMock)
  }
  const NEWS = [
    { id: 'n1', title: 'T1', url: 'https://example.com/n1', text: 'b1' },
    { id: 'n2', title: 'T2', url: 'https://example.com/n2', text: 'b2' },
  ]

  // ★ 這條釘的是接線本身。orchestrator → narrative 的 officialBlock 在加進來的當下
  // 零測試覆蓋——所有 loadMarketContext 的 mock 都沒有這個欄位，而 tsconfig 排除
  // *.test.ts，所以型別也擋不到；接線斷掉不會有任何東西紅。
  it('把 officialBlock 從 market context 傳給 narrative writer', async () => {
    setupHappyMocks()
    vi.mocked(marketContextMod.loadMarketContext).mockResolvedValue({
      snapshotBlock: null,
      calendarBlock: null,
      officialBlock: '- 2026-04-25（央行）115年3月金融情況',
      taiexCloseDate: null,
    } as unknown as Awaited<ReturnType<typeof marketContextMod.loadMarketContext>>)
    const metadata: RunMetadata = { llmCalls: [], totalCostUsd: 0, totalLatencyMs: 0 }
    await runDailyBrief({ news: NEWS, date: '2026-04-25', metadata })
    expect(narrativeWriterMod.callNarrativeWriter).toHaveBeenCalledWith(
      expect.objectContaining({ officialBlock: '- 2026-04-25（央行）115年3月金融情況' }),
    )
  })

  it('attaches viewpoints when debate returns a value (dailyThesis present)', async () => {
    setupHappyMocks()
    const vp = { supportPoints: ['s1', 's2'], riskPoints: ['r1', 'r2'], netRead: 'a'.repeat(150) }
    vi.mocked(viewpointsMod.runViewpointsDebate).mockResolvedValue(vp)
    const metadata: RunMetadata = { llmCalls: [], totalCostUsd: 0, totalLatencyMs: 0 }
    const dailyThesis = '利率重新定價是今日跨市場波動的主要驅動因素'
    const brief = await runDailyBrief({ news: NEWS, date: '2026-04-25', metadata, dailyThesis })
    expect(viewpointsMod.runViewpointsDebate).toHaveBeenCalledTimes(1)
    expect(viewpointsMod.runViewpointsDebate).toHaveBeenCalledWith(expect.objectContaining({ thesis: dailyThesis }))
    expect(narrativeWriterMod.callNarrativeWriter).toHaveBeenCalledWith(expect.objectContaining({ dailyThesis }))
    expect(brief.dailyThesis).toBe(dailyThesis)
    expect(brief.viewpoints).toEqual(vp)
  })

  it('uses the safety-rewritten dailyThesis for viewpoints, narrative, and the stored brief', async () => {
    setupHappyMocks()
    const metadata: RunMetadata = { llmCalls: [], totalCostUsd: 0, totalLatencyMs: 0 }
    const brief = await runDailyBrief({
      news: NEWS,
      date: '2026-04-25',
      metadata,
      dailyThesis: '市場看多氣氛帶動風險偏好延續',
    })
    const safeDailyThesis = '市場動能延續氣氛帶動風險偏好延續'
    expect(brief.dailyThesis).toBe(safeDailyThesis)
    expect(viewpointsMod.runViewpointsDebate).toHaveBeenCalledWith(expect.objectContaining({ thesis: safeDailyThesis }))
    expect(narrativeWriterMod.callNarrativeWriter).toHaveBeenCalledWith(expect.objectContaining({ dailyThesis: safeDailyThesis }))
  })

  it('drops an unsafe dailyThesis before downstream calls without failing the brief', async () => {
    setupHappyMocks()
    const metadata: RunMetadata = { llmCalls: [], totalCostUsd: 0, totalLatencyMs: 0 }
    const brief = await runDailyBrief({
      news: NEWS,
      date: '2026-04-25',
      metadata,
      dailyThesis: '保證獲利保證獲利保證獲利',
    })
    expect(brief.dailyThesis).toBeUndefined()
    expect(brief.viewpoints).toBeNull()
    expect(viewpointsMod.runViewpointsDebate).not.toHaveBeenCalled()
    expect(narrativeWriterMod.callNarrativeWriter).toHaveBeenCalledWith(
      expect.not.objectContaining({ dailyThesis: expect.anything() }),
    )
  })

  it('sets viewpoints null when debate degrades', async () => {
    setupHappyMocks()
    vi.mocked(viewpointsMod.runViewpointsDebate).mockResolvedValue(null)
    const metadata: RunMetadata = { llmCalls: [], totalCostUsd: 0, totalLatencyMs: 0 }
    const brief = await runDailyBrief({ news: NEWS, date: '2026-04-25', metadata, dailyThesis: '利率重新定價是今日跨市場波動的主要驅動因素' })
    expect(brief.viewpoints).toBeNull()
  })

  it('skips debate and sets viewpoints null when no dailyThesis', async () => {
    setupHappyMocks()
    const metadata: RunMetadata = { llmCalls: [], totalCostUsd: 0, totalLatencyMs: 0 }
    const brief = await runDailyBrief({ news: NEWS, date: '2026-04-25', metadata })
    expect(viewpointsMod.runViewpointsDebate).not.toHaveBeenCalled()
    expect(brief.viewpoints).toBeNull()
  })
})

// decomposer / per-news retrieve / analyst tier-1 這三處扇出原本沒有並行上限，密集打法會讓
// LLM provider 把 project 判成 suspicious activity。這裡驗證
// pMap/pMapSettled 換掉 Promise.all/allSettled 之後真的把 in-flight 峰值頂住了。
describe('runDailyBrief fan-out concurrency', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(narrativeWriterMod.callNarrativeWriter).mockResolvedValue({
      narrative: null,
      audit: { failed: false, retryReason: null, fabricationStripped: 0, claimIdsStripped: 0, claimCitationUrlsDropped: 0, claimCitationSections: 0, claimUnboundNumbers: 0, claimCheckedNumbers: 0, claimIdsTruncated: 0 },
    })
    vi.mocked(marketContextMod.loadMarketContext).mockResolvedValue({ snapshotBlock: null, calendarBlock: null, taiexCloseDate: null })
    vi.mocked(viewpointsMod.runViewpointsDebate).mockResolvedValue(null)
    vi.mocked(synthesizerMod.callSynthesizer).mockResolvedValue(validSynthMock)
  })

  function newsBatch(n: number) {
    return Array.from({ length: n }, (_, i) => ({ id: `n${i}`, title: `T${i}`, url: `https://example.com/n${i}`, text: `b${i}`, publishedAt: null }))
  }

  it(`bounds decomposer fan-out in-flight calls to DECOMPOSER_FANOUT_CONCURRENCY (${DECOMPOSER_FANOUT_CONCURRENCY})`, async () => {
    let inFlight = 0
    let peak = 0
    vi.mocked(decomposerMod.callDecomposer).mockImplementation(async () => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise(resolve => setImmediate(resolve))
      inFlight--
      return { primaryEntity: { name: 'X', kind: 'company' }, topicTags: [], cascadeHypotheses: [] }
    })
    vi.mocked(retrieverMod.retrieveArticles).mockResolvedValue([])
    vi.mocked(analystMod.callAnalystTier1).mockResolvedValue({ primaryImpact: 'p', cascadeChains: [], reasoning: 'r' })

    const metadata: RunMetadata = { llmCalls: [], totalCostUsd: 0, totalLatencyMs: 0 }
    await runDailyBrief({ news: newsBatch(8), date: '2026-04-25', metadata })

    expect(peak).toBeLessThanOrEqual(DECOMPOSER_FANOUT_CONCURRENCY)
    expect(peak).toBeGreaterThan(1) // sanity：確認真的有並行、不是退化成序列
  })

  it(`bounds retrieve fan-out in-flight calls to RETRIEVE_FANOUT_CONCURRENCY (${RETRIEVE_FANOUT_CONCURRENCY})`, async () => {
    vi.mocked(decomposerMod.callDecomposer).mockResolvedValue({
      primaryEntity: { name: 'X', kind: 'company' },
      topicTags: [],
      cascadeHypotheses: [{ industry: 'i', mechanism: 'm', retrieveQuery: { entities: ['X'], days: 7 } }],
    })
    let inFlight = 0
    let peak = 0
    vi.mocked(retrieverMod.retrieveArticles).mockImplementation(async () => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise(resolve => setImmediate(resolve))
      inFlight--
      return []
    })
    vi.mocked(analystMod.callAnalystTier1).mockResolvedValue({ primaryImpact: 'p', cascadeChains: [], reasoning: 'r' })

    const metadata: RunMetadata = { llmCalls: [], totalCostUsd: 0, totalLatencyMs: 0 }
    await runDailyBrief({ news: newsBatch(8), date: '2026-04-25', metadata })

    expect(peak).toBeLessThanOrEqual(RETRIEVE_FANOUT_CONCURRENCY)
    expect(peak).toBeGreaterThan(1)
  })

  it(`bounds analyst tier-1 fan-out in-flight calls to ANALYST_TIER1_FANOUT_CONCURRENCY (${ANALYST_TIER1_FANOUT_CONCURRENCY})`, async () => {
    vi.mocked(decomposerMod.callDecomposer).mockResolvedValue({
      primaryEntity: { name: 'X', kind: 'company' },
      topicTags: [],
      cascadeHypotheses: [],
    })
    vi.mocked(retrieverMod.retrieveArticles).mockResolvedValue([])
    let inFlight = 0
    let peak = 0
    vi.mocked(analystMod.callAnalystTier1).mockImplementation(async () => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise(resolve => setImmediate(resolve))
      inFlight--
      return { primaryImpact: 'p', cascadeChains: [], reasoning: 'r' }
    })

    const metadata: RunMetadata = { llmCalls: [], totalCostUsd: 0, totalLatencyMs: 0 }
    await runDailyBrief({ news: newsBatch(8), date: '2026-04-25', metadata })

    expect(peak).toBeLessThanOrEqual(ANALYST_TIER1_FANOUT_CONCURRENCY)
    expect(peak).toBeGreaterThan(1)
  })

  it('keeps partialFailed reporting intact under the bounded decomposer fan-out', async () => {
    // 回歸守衛：pMapSettled 換掉 Promise.allSettled 之後，「單一失敗不中斷整批」的
    // 語意與 metadata.partialSuccess 統計必須維持不變（既有的
    // 'should skip news where decomposer fails' 已涵蓋這點，這裡在批量大於並行上限的
    // 情境下再驗一次，確保 bound 不會意外改變 partialFailed 的行為）。
    const news = newsBatch(6)
    let call = 0
    vi.mocked(decomposerMod.callDecomposer).mockImplementation(async () => {
      call++
      if (call === 3)
        throw new Error('decomposer boom')
      return { primaryEntity: { name: 'X', kind: 'company' }, topicTags: [], cascadeHypotheses: [] }
    })
    vi.mocked(retrieverMod.retrieveArticles).mockResolvedValue([])
    vi.mocked(analystMod.callAnalystTier1).mockResolvedValue({ primaryImpact: 'p', cascadeChains: [], reasoning: 'r' })

    const metadata: RunMetadata = { llmCalls: [], totalCostUsd: 0, totalLatencyMs: 0 }
    const brief = await runDailyBrief({ news, date: '2026-04-25', metadata })

    expect(brief.summary).toBe('final')
    expect(metadata.partialSuccess?.failedNewsIds).toEqual(['n2'])
    expect(analystMod.callAnalystTier1).toHaveBeenCalledTimes(5)
  })
})

describe('runSingleNews', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('should run decomposer + retriever + analyst, skip synthesizer', async () => {
    vi.mocked(decomposerMod.callDecomposer).mockResolvedValue({
      primaryEntity: { name: 'X', kind: 'c' },
      topicTags: [],
      cascadeHypotheses: [{ industry: 'i', mechanism: 'm', retrieveQuery: { entities: ['X'], days: 7 } }],
    })
    vi.mocked(retrieverMod.retrieveArticles).mockResolvedValue([])
    vi.mocked(analystMod.callAnalystTier1).mockResolvedValue({
      primaryImpact: 'imp',
      cascadeChains: [],
      reasoning: 'r',
    })

    const metadata: RunMetadata = { llmCalls: [], totalCostUsd: 0, totalLatencyMs: 0 }
    const result = await runSingleNews({
      input: { title: 'T', text: 'b' },
      metadata,
    })
    expect(result.analyst.primaryImpact).toBe('imp')
    expect(result.retrievedUrls).toEqual([])
    expect(synthesizerMod.callSynthesizer).not.toHaveBeenCalled()
  })

  it('should expand hypothesis entities through alias map before calling retriever', async () => {
    const aliasMap = buildAliasMap([
      { canonical: 'fed', aliases: ['Fed', 'FOMC', '聯準會'] },
    ])
    vi.mocked(retrieverMod.retrieveArticles).mockResolvedValue([])
    await retrieveForDecomposed({
      primaryEntity: { name: 'Fed', kind: 'event' },
      topicTags: [],
      cascadeHypotheses: [
        { industry: 'i', mechanism: 'm', retrieveQuery: { entities: ['Fed'], days: 7 } },
      ],
    }, '2026-06-12', aliasMap)

    expect(retrieverMod.retrieveArticles).toHaveBeenCalledTimes(1)
    const callArgs = vi.mocked(retrieverMod.retrieveArticles).mock.calls[0]?.[0]
    expect(callArgs?.entities).toContain('Fed')
    expect(callArgs?.entities).toContain('FOMC')
    expect(callArgs?.entities).toContain('聯準會')
  })

  it('should expose retrievedUrls deduped across cascade hypotheses', async () => {
    vi.mocked(decomposerMod.callDecomposer).mockResolvedValue({
      primaryEntity: { name: 'X', kind: 'c' },
      topicTags: [],
      cascadeHypotheses: [
        { industry: 'i', mechanism: 'm', retrieveQuery: { entities: ['A'], days: 7 } },
        { industry: 'i2', mechanism: 'm2', retrieveQuery: { entities: ['B'], days: 7 } },
      ],
    })
    vi.mocked(retrieverMod.retrieveArticles)
      .mockResolvedValueOnce([
        { id: '1', url: 'https://example.com/1', title: 't1', contentSummary: null, entities: [], topicTags: [], fetchedAt: '2026-04-25' },
        { id: '2', url: 'https://example.com/2', title: 't2', contentSummary: null, entities: [], topicTags: [], fetchedAt: '2026-04-25' },
      ])
      .mockResolvedValueOnce([
        { id: '2', url: 'https://example.com/2', title: 't2', contentSummary: null, entities: [], topicTags: [], fetchedAt: '2026-04-25' },
        { id: '3', url: 'https://example.com/3', title: 't3', contentSummary: null, entities: [], topicTags: [], fetchedAt: '2026-04-25' },
      ])
    vi.mocked(analystMod.callAnalystTier1).mockResolvedValue({
      primaryImpact: 'imp',
      cascadeChains: [],
      reasoning: 'r',
    })

    const metadata: RunMetadata = { llmCalls: [], totalCostUsd: 0, totalLatencyMs: 0 }
    const result = await runSingleNews({ input: { title: 'T', text: 'b' }, metadata })
    expect(result.retrievedUrls).toEqual([
      'https://example.com/1',
      'https://example.com/2',
      'https://example.com/3',
    ])
  })
})

describe('runAnalystOnly', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })
  it('skips decomposer + retriever, calls analyst with synthetic decomposed', async () => {
    vi.mocked(analystMod.callAnalystTier1).mockResolvedValue({
      primaryImpact: 'imp',
      cascadeChains: [],
      reasoning: 'r',
    })
    const metadata: RunMetadata = { llmCalls: [], totalCostUsd: 0, totalLatencyMs: 0 }
    const result = await runAnalystOnly({
      input: { title: 'T', text: 'B' },
      inputCanonical: ['fed', 'rate-cut'],
      priorChains: [{ industry: '半導體', mechanism: 'm', affectedTickers: ['TSMC'], direction: 'positive', citations: [] }],
      metadata,
    })
    expect(decomposerMod.callDecomposer).not.toHaveBeenCalled()
    expect(retrieverMod.retrieveArticles).not.toHaveBeenCalled()
    expect(analystMod.callAnalystTier1).toHaveBeenCalledTimes(1)
    expect(result.primaryImpact).toBe('imp')
  })
})

describe('stampTier1', () => {
  it('shapes raw analyst chains with chainId / tier / parentChainId', () => {
    const raw = [
      { industry: 'A', mechanism: 'm', affectedTickers: [], direction: 'positive' as const, citations: [], nextTierEntities: ['x'] },
      { industry: 'B', mechanism: 'm', affectedTickers: [], direction: 'neutral' as const, citations: [] },
    ]
    const stamped = stampTier1(raw)
    expect(stamped[0]).toMatchObject({ chainId: 't1-0', tier: 1, parentChainId: undefined })
    expect(stamped[1]).toMatchObject({ chainId: 't1-1', tier: 1, parentChainId: undefined })
    expect(stamped[0]?.nextTierEntities).toEqual(['x'])
  })

  it('never marks tier1 chains as speculative', () => {
    const raw = [
      { industry: 'A', mechanism: 'm', affectedTickers: [], direction: 'positive' as const, citations: [] },
      { industry: 'B', mechanism: 'm', affectedTickers: [], direction: 'neutral' as const, citations: [{ url: 'https://x/1', title: 't', quote: 'q' }] },
    ]
    const stamped = stampTier1(raw)
    expect(stamped[0]?.speculative).toBeUndefined()
    expect(stamped[1]?.speculative).toBeUndefined()
  })

  it('dedupes nextTierEntities against own affectedTickers', () => {
    const raw = [{
      industry: 'A',
      mechanism: 'm',
      affectedTickers: ['日月光'],
      direction: 'positive' as const,
      citations: [],
      nextTierEntities: ['日月光', '愛德萬測試'],
    }]
    const stamped = stampTier1(raw)
    expect(stamped[0]?.nextTierEntities).toEqual(['愛德萬測試'])
  })

  it('drops nextTierEntities entirely when all dedup-removed', () => {
    const raw = [{
      industry: 'A',
      mechanism: 'm',
      affectedTickers: ['日月光'],
      direction: 'positive' as const,
      citations: [],
      nextTierEntities: ['日月光'],
    }]
    const stamped = stampTier1(raw)
    expect(stamped[0]?.nextTierEntities).toBeUndefined()
  })

  it('preserves chains with no nextTierEntities (undefined input)', () => {
    const raw = [{ industry: 'A', mechanism: 'm', affectedTickers: [], direction: 'neutral' as const, citations: [] }]
    const stamped = stampTier1(raw)
    expect(stamped[0]?.nextTierEntities).toBeUndefined()
  })
})

describe('runSingleNews tier 2 integration', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns flat cascadeChains with tier 1 + tier 2', async () => {
    vi.mocked(decomposerMod.callDecomposer).mockResolvedValue({
      primaryEntity: { name: 'X', kind: 'company' },
      topicTags: [],
      cascadeHypotheses: [],
    })
    vi.mocked(retrieverMod.retrieveArticles).mockResolvedValue([
      { id: '1', url: 'https://known/x', title: 'r', contentSummary: '', entities: [], topicTags: [], fetchedAt: '2026-04-25' },
    ])
    vi.mocked(analystMod.callAnalystTier1).mockResolvedValue({
      primaryImpact: 'p',
      cascadeChains: [
        { industry: '半導體封測', mechanism: 'm', affectedTickers: [], direction: 'positive', citations: [], nextTierEntities: ['愛德萬測試'] },
      ],
      reasoning: 'r',
    })
    vi.mocked(analystMod.callAnalystTier2).mockResolvedValue({
      primaryImpact: 'p',
      cascadeChains: [
        { industry: '半導體測試設備', mechanism: 'tier 2 m', affectedTickers: [], direction: 'positive', citations: [] },
      ],
      reasoning: 'r',
    })

    const metadata: RunMetadata = { llmCalls: [], totalCostUsd: 0, totalLatencyMs: 0 }
    const result = await runSingleNews({ input: { title: 't', text: 'x' }, metadata })

    expect(result.analyst.cascadeChains).toHaveLength(2)
    expect(result.analyst.cascadeChains[0]).toMatchObject({ tier: 1, chainId: 't1-0', industry: '半導體封測' })
    expect(result.analyst.cascadeChains[1]).toMatchObject({ tier: 2, chainId: 't2-0', parentChainId: 't1-0', industry: '半導體測試設備' })
  })

  it('returns tier 1 only when no nextTierEntities', async () => {
    vi.mocked(decomposerMod.callDecomposer).mockResolvedValue({
      primaryEntity: { name: 'X', kind: 'company' },
      topicTags: [],
      cascadeHypotheses: [],
    })
    vi.mocked(retrieverMod.retrieveArticles).mockResolvedValue([])
    vi.mocked(analystMod.callAnalystTier1).mockResolvedValue({
      primaryImpact: 'p',
      cascadeChains: [
        { industry: 'A', mechanism: 'm', affectedTickers: [], direction: 'neutral', citations: [] },
      ],
      reasoning: 'r',
    })
    const metadata: RunMetadata = { llmCalls: [], totalCostUsd: 0, totalLatencyMs: 0 }
    const result = await runSingleNews({ input: { title: 't', text: 'x' }, metadata })
    expect(result.analyst.cascadeChains).toHaveLength(1)
    expect(result.analyst.cascadeChains[0]).toMatchObject({ tier: 1, chainId: 't1-0' })
    expect(vi.mocked(analystMod.callAnalystTier2)).not.toHaveBeenCalled()
  })
})

describe('runAnalystOnly tier 2 integration', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('runs tier 2 fanout in db-related mode', async () => {
    vi.mocked(retrieverMod.retrieveArticles).mockResolvedValue([
      { id: '1', url: 'https://known/x', title: 'r', contentSummary: '', entities: [], topicTags: [], fetchedAt: '2026-04-25' },
    ])
    vi.mocked(analystMod.callAnalystTier1).mockResolvedValue({
      primaryImpact: 'p',
      cascadeChains: [
        { industry: 'A', mechanism: 'm', affectedTickers: [], direction: 'positive', citations: [], nextTierEntities: ['partner'] },
      ],
      reasoning: 'r',
    })
    vi.mocked(analystMod.callAnalystTier2).mockResolvedValue({
      primaryImpact: 'p',
      cascadeChains: [
        { industry: 'B', mechanism: 'm', affectedTickers: [], direction: 'positive', citations: [] },
      ],
      reasoning: 'r',
    })

    const metadata: RunMetadata = { llmCalls: [], totalCostUsd: 0, totalLatencyMs: 0 }
    const result = await runAnalystOnly({
      input: { title: 't', text: 'x' },
      inputCanonical: ['A'],
      priorChains: [],
      metadata,
    })
    expect(result.cascadeChains).toHaveLength(2)
    expect(result.cascadeChains[0]).toMatchObject({ tier: 1 })
    expect(result.cascadeChains[1]).toMatchObject({ tier: 2, parentChainId: 't1-0' })
  })
})

describe('runDailyBrief tier 2 integration', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    // narrative stub null for these tests
    vi.mocked(narrativeWriterMod.callNarrativeWriter).mockResolvedValue({
      narrative: null,
      audit: { failed: false, retryReason: null, fabricationStripped: 0, claimIdsStripped: 0, claimCitationUrlsDropped: 0, claimCitationSections: 0, claimUnboundNumbers: 0, claimCheckedNumbers: 0, claimIdsTruncated: 0 },
    })
    vi.mocked(marketContextMod.loadMarketContext).mockResolvedValue({ snapshotBlock: null, calendarBlock: null, taiexCloseDate: null })
  })

  it('per-news tier 2 fanout fires within Promise.allSettled', async () => {
    const news = [
      { id: 'n1', title: 'T1', url: 'https://example.com/n1', text: 'b1' },
      { id: 'n2', title: 'T2', url: 'https://example.com/n2', text: 'b2' },
    ]
    vi.mocked(decomposerMod.callDecomposer).mockResolvedValue({
      primaryEntity: { name: 'X', kind: 'c' },
      topicTags: [],
      cascadeHypotheses: [],
    })
    vi.mocked(retrieverMod.retrieveArticles).mockResolvedValue([
      { id: '1', url: 'https://x', title: 'r', contentSummary: '', entities: [], topicTags: [], fetchedAt: '2026-04-25' },
    ])
    vi.mocked(analystMod.callAnalystTier1).mockResolvedValue({
      primaryImpact: 'p',
      cascadeChains: [
        { industry: 'A', mechanism: 'm', affectedTickers: [], direction: 'positive', citations: [], nextTierEntities: ['partner'] },
      ],
      reasoning: 'r',
    })
    vi.mocked(analystMod.callAnalystTier2).mockResolvedValue({
      primaryImpact: 'p',
      cascadeChains: [
        { industry: 'B', mechanism: 'm', affectedTickers: [], direction: 'positive', citations: [] },
      ],
      reasoning: 'r',
    })
    vi.mocked(synthesizerMod.callSynthesizer).mockResolvedValue(validSynthMock)

    const metadata: RunMetadata = { llmCalls: [], totalCostUsd: 0, totalLatencyMs: 0 }
    await runDailyBrief({ news, date: '2026-04-25', metadata })
    // 2 news × 1 tier 1 chain × 1 tier 2 fanout = 2 tier 2 calls
    expect(vi.mocked(analystMod.callAnalystTier2)).toHaveBeenCalledTimes(2)
  })
})

describe('runTier2Fanout', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns empty when no tier 1 chains have nextTierEntities', async () => {
    const tier1 = [
      { chainId: 't1-0', tier: 1 as const, industry: 'A', mechanism: 'm', affectedTickers: [], direction: 'positive' as const, citations: [] },
    ]
    const result = await runTier2Fanout({
      news: { title: 't', text: 'x' },
      tier1Chains: tier1,
      reportDate: '2026-06-12',
      onCallRecord: () => {},
    })
    expect(result).toEqual([])
  })

  it('skips tier 2 Analyst when retriever returns empty', async () => {
    vi.mocked(retrieverMod.retrieveArticles).mockResolvedValue([])
    const tier1 = [
      { chainId: 't1-0', tier: 1 as const, industry: 'A', mechanism: 'm', affectedTickers: [], direction: 'positive' as const, citations: [], nextTierEntities: ['x'] },
    ]
    const result = await runTier2Fanout({
      news: { title: 't', text: 'x' },
      tier1Chains: tier1,
      reportDate: '2026-06-12',
      onCallRecord: () => {},
    })
    expect(result).toEqual([])
    expect(vi.mocked(analystMod.callAnalystTier2)).not.toHaveBeenCalled()
  })

  it('stamps tier 2 chains with chainId t2-{idx} and parentChainId', async () => {
    vi.mocked(retrieverMod.retrieveArticles).mockResolvedValue([
      { id: '1', url: 'https://known/x', title: 'r', contentSummary: 's', entities: [], topicTags: [], fetchedAt: '2026-04-25' },
    ])
    vi.mocked(analystMod.callAnalystTier2).mockResolvedValue({
      primaryImpact: 'p',
      cascadeChains: [
        { industry: 'X', mechanism: 'm', affectedTickers: [], direction: 'positive', citations: [] },
        { industry: 'Y', mechanism: 'm', affectedTickers: [], direction: 'neutral', citations: [] },
      ],
      reasoning: 'r',
    })
    const tier1 = [
      { chainId: 't1-0', tier: 1 as const, industry: 'A', mechanism: 'm', affectedTickers: [], direction: 'positive' as const, citations: [], nextTierEntities: ['愛德萬測試'] },
    ]
    const result = await runTier2Fanout({
      news: { title: 't', text: 'x' },
      tier1Chains: tier1,
      reportDate: '2026-06-12',
      onCallRecord: () => {},
    })
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ chainId: 't2-0', tier: 2, parentChainId: 't1-0' })
    expect(result[1]).toMatchObject({ chainId: 't2-1', tier: 2, parentChainId: 't1-0' })
    expect(result[0]?.nextTierEntities).toBeUndefined()
    expect(result[1]?.nextTierEntities).toBeUndefined()
  })

  it('graceful degrades when Analyst tier 2 fails for one parent', async () => {
    vi.mocked(retrieverMod.retrieveArticles).mockResolvedValue([
      { id: '1', url: 'https://known/x', title: 'r', contentSummary: '', entities: [], topicTags: [], fetchedAt: '2026-04-25' },
    ])
    vi.mocked(analystMod.callAnalystTier2)
      .mockRejectedValueOnce(new Error('Analyst tier 2 fail'))
      .mockResolvedValueOnce({
        primaryImpact: 'p',
        cascadeChains: [{ industry: 'Y', mechanism: 'm', affectedTickers: [], direction: 'positive', citations: [] }],
        reasoning: 'r',
      })
    const tier1 = [
      { chainId: 't1-0', tier: 1 as const, industry: 'A', mechanism: 'm', affectedTickers: [], direction: 'positive' as const, citations: [], nextTierEntities: ['x'] },
      { chainId: 't1-1', tier: 1 as const, industry: 'B', mechanism: 'm', affectedTickers: [], direction: 'positive' as const, citations: [], nextTierEntities: ['y'] },
    ]
    const result = await runTier2Fanout({
      news: { title: 't', text: 'x' },
      tier1Chains: tier1,
      reportDate: '2026-06-12',
      onCallRecord: () => {},
    })
    // First parent failed (no chain), second parent's tier 2 chain returned
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ tier: 2, parentChainId: 't1-1' })
  })

  it('marks tier2 chains without citations as speculative', async () => {
    vi.mocked(retrieverMod.retrieveArticles).mockResolvedValue([
      { id: '1', url: 'https://known/x', title: 'r', contentSummary: 's', entities: [], topicTags: [], fetchedAt: '2026-04-25' },
    ])
    vi.mocked(analystMod.callAnalystTier2).mockResolvedValue({
      primaryImpact: 'p',
      cascadeChains: [
        { industry: 'NoCite', mechanism: 'm', affectedTickers: [], direction: 'positive', citations: [] },
        { industry: 'HasCite', mechanism: 'm', affectedTickers: [], direction: 'neutral', citations: [{ url: 'https://known/x', title: 'r', quote: 'q' }] },
      ],
      reasoning: 'r',
    })
    const tier1 = [
      { chainId: 't1-0', tier: 1 as const, industry: 'A', mechanism: 'm', affectedTickers: [], direction: 'positive' as const, citations: [], nextTierEntities: ['x'] },
    ]
    const result = await runTier2Fanout({
      news: { title: 't', text: 'x' },
      tier1Chains: tier1,
      reportDate: '2026-06-12',
      onCallRecord: () => {},
    })
    expect(result).toHaveLength(2)
    expect(result[0]?.speculative).toBe(true)
    expect(result[1]?.speculative).toBeUndefined()
  })
})

describe('runDailyBrief · real-url wiring end-to-end (citation-real-source-url)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(narrativeWriterMod.callNarrativeWriter).mockResolvedValue({
      narrative: null,
      audit: { failed: false, retryReason: null, fabricationStripped: 0, claimIdsStripped: 0, claimCitationUrlsDropped: 0, claimCitationSections: 0, claimUnboundNumbers: 0, claimCheckedNumbers: 0, claimIdsTruncated: 0 },
    })
    vi.mocked(marketContextMod.loadMarketContext).mockResolvedValue({ snapshotBlock: null, calendarBlock: null, taiexCloseDate: null })
  })

  it('resolves relatedNews url from selectedNewsById and assembles citations from real https analyst urls', async () => {
    const news = [
      { id: 'n1', title: '台積電擴廠', url: 'https://example.com/n1', text: '台積電宣布擴廠計畫' },
      { id: 'n2', title: '三星追趕', url: 'https://example.com/n2', text: '三星加大投資半導體' },
    ]
    vi.mocked(decomposerMod.callDecomposer).mockResolvedValue({
      primaryEntity: { name: 'TSMC', kind: 'company' },
      topicTags: [],
      cascadeHypotheses: [],
    })
    vi.mocked(retrieverMod.retrieveArticles).mockResolvedValue([])
    // 兩則新聞都回有真 url citations 的 analyst output
    vi.mocked(analystMod.callAnalystTier1).mockResolvedValue({
      primaryImpact: 'p',
      cascadeChains: [
        {
          industry: '半導體',
          mechanism: 'm',
          affectedTickers: ['TSMC'],
          direction: 'positive',
          citations: [{ url: 'https://src.com/a', title: 't', quote: 'q' }],
        },
      ],
      reasoning: 'r',
    })
    // Synthesizer 回 relatedNews 引用 n1 newsId
    vi.mocked(synthesizerMod.callSynthesizer).mockResolvedValue({
      ...validSynthMock,
      relatedNews: [{ newsId: 'n1', relationType: 'cause', reasoning: 'r' }],
    })

    const metadata: RunMetadata = { llmCalls: [], totalCostUsd: 0, totalLatencyMs: 0 }
    const brief = await runDailyBrief({ news, date: '2026-06-16', metadata })

    // relatedNews[0].url 應 resolve 到 n1 的真 url（驗 newsId↔news.id 對齊 + by-id resolve）
    expect(brief.relatedNews[0]?.url).toBe('https://example.com/n1')
    // citations 應含真 https url、不含 data: sentinel
    expect(brief.citations.some(c => c.url.startsWith('https://'))).toBe(true)
    expect(brief.citations.every(c => !c.url.startsWith('data:'))).toBe(true)
  })
})

// runDailyBrief 加 narrative + newsTitlesById
const narrativeMock = {
  intro: 'a'.repeat(150),
  sections: [
    { newsId: 'n1', body: 'a'.repeat(300), citationUrls: ['https://x/1'] },
    { newsId: 'n2', body: 'a'.repeat(300), citationUrls: ['https://x/1'] },
  ],
  outro: 'a'.repeat(150),
}

describe('runDailyBrief · narrative integration', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(marketContextMod.loadMarketContext).mockResolvedValue({ snapshotBlock: null, calendarBlock: null, taiexCloseDate: null })
  })

  function setupHappyPath() {
    vi.mocked(decomposerMod.callDecomposer).mockResolvedValue({
      primaryEntity: { name: 'X', kind: 'company' },
      topicTags: [],
      cascadeHypotheses: [
        { industry: 'i1', mechanism: 'm1', retrieveQuery: { entities: ['X'], days: 7 } },
      ],
    })
    vi.mocked(retrieverMod.retrieveArticles).mockResolvedValue([])
    vi.mocked(analystMod.callAnalystTier1).mockResolvedValue({
      primaryImpact: 'p',
      cascadeChains: [],
      reasoning: 'r',
    })
    vi.mocked(synthesizerMod.callSynthesizer).mockResolvedValue(validSynthMock)
  }

  it('passes narrative from NarrativeWriter into MarketBrief output', async () => {
    setupHappyPath()
    vi.mocked(narrativeWriterMod.callNarrativeWriter).mockResolvedValue({
      narrative: narrativeMock,
      audit: { failed: false, retryReason: null, fabricationStripped: 0, claimIdsStripped: 0, claimCitationUrlsDropped: 0, claimCitationSections: 0, claimUnboundNumbers: 0, claimCheckedNumbers: 0, claimIdsTruncated: 0 },
    })
    const news = [
      { id: 'n1', title: '日月光', url: 'https://example.com/n1', text: 'b1' },
      { id: 'n2', title: 'AVGO', url: 'https://example.com/n2', text: 'b2' },
    ]
    const metadata: RunMetadata = { llmCalls: [], totalCostUsd: 0, totalLatencyMs: 0 }
    const brief = await runDailyBrief({ news, date: '2026-04-29', metadata })
    expect(brief.narrative).toBeTruthy()
    expect(brief.narrative?.sections).toHaveLength(2)
    expect(brief.newsTitlesById).toEqual({ n1: '日月光', n2: 'AVGO' })
  })

  it('returns brief with narrative=null when NarrativeWriter graceful degrades', async () => {
    setupHappyPath()
    vi.mocked(narrativeWriterMod.callNarrativeWriter).mockResolvedValue({
      narrative: null,
      audit: { failed: true, retryReason: 'zod-parse', fabricationStripped: 0, claimIdsStripped: 0, claimCitationUrlsDropped: 0, claimCitationSections: 0, claimUnboundNumbers: 0, claimCheckedNumbers: 0, claimIdsTruncated: 0 },
    })
    const news = [
      { id: 'n1', title: 'T1', url: 'https://example.com/n1', text: 'b1' },
      { id: 'n2', title: 'T2', url: 'https://example.com/n2', text: 'b2' },
    ]
    const metadata: RunMetadata = { llmCalls: [], totalCostUsd: 0, totalLatencyMs: 0 }
    const brief = await runDailyBrief({ news, date: '2026-04-29', metadata })
    expect(brief.narrative).toBeNull()
    expect(brief.summary).toBe('final') // 既有 brief 仍 ship
    expect(brief.newsTitlesById).toEqual({ n1: 'T1', n2: 'T2' })
  })

  it('passes storylineBlock through to NarrativeWriter when provided', async () => {
    setupHappyPath()
    vi.mocked(narrativeWriterMod.callNarrativeWriter).mockResolvedValue({
      narrative: null,
      audit: { failed: false, retryReason: null, fabricationStripped: 0, claimIdsStripped: 0, claimCitationUrlsDropped: 0, claimCitationSections: 0, claimUnboundNumbers: 0, claimCheckedNumbers: 0, claimIdsTruncated: 0 },
    })
    const news = [
      { id: 'n1', title: 'T1', url: 'https://example.com/n1', text: 'b1' },
      { id: 'n2', title: 'T2', url: 'https://example.com/n2', text: 'b2' },
    ]
    const metadata: RunMetadata = { llmCalls: [], totalCostUsd: 0, totalLatencyMs: 0 }
    await runDailyBrief({ news, date: '2026-04-29', metadata, storylineBlock: 'X' })
    expect(vi.mocked(narrativeWriterMod.callNarrativeWriter).mock.calls[0]?.[0]?.storylineBlock).toBe('X')
  })

  it('passes storylineBlock=null to NarrativeWriter when not provided', async () => {
    setupHappyPath()
    vi.mocked(narrativeWriterMod.callNarrativeWriter).mockResolvedValue({
      narrative: null,
      audit: { failed: false, retryReason: null, fabricationStripped: 0, claimIdsStripped: 0, claimCitationUrlsDropped: 0, claimCitationSections: 0, claimUnboundNumbers: 0, claimCheckedNumbers: 0, claimIdsTruncated: 0 },
    })
    const news = [
      { id: 'n1', title: 'T1', url: 'https://example.com/n1', text: 'b1' },
      { id: 'n2', title: 'T2', url: 'https://example.com/n2', text: 'b2' },
    ]
    const metadata: RunMetadata = { llmCalls: [], totalCostUsd: 0, totalLatencyMs: 0 }
    await runDailyBrief({ news, date: '2026-04-29', metadata })
    expect(vi.mocked(narrativeWriterMod.callNarrativeWriter).mock.calls[0]?.[0]?.storylineBlock).toBeNull()
  })

  it('builds newsTitlesById from survivedNews titles only', async () => {
    setupHappyPath()
    // 第二則 decomposer fail、應該只 newsTitlesById 含 n1 + n3
    vi.mocked(decomposerMod.callDecomposer)
      .mockResolvedValueOnce({ primaryEntity: { name: 'X', kind: 'c' }, topicTags: [], cascadeHypotheses: [] })
      .mockRejectedValueOnce(new Error('Gemini timeout'))
      .mockResolvedValueOnce({ primaryEntity: { name: 'Y', kind: 'c' }, topicTags: [], cascadeHypotheses: [] })
    vi.mocked(narrativeWriterMod.callNarrativeWriter).mockResolvedValue({
      narrative: narrativeMock,
      audit: { failed: false, retryReason: null, fabricationStripped: 0, claimIdsStripped: 0, claimCitationUrlsDropped: 0, claimCitationSections: 0, claimUnboundNumbers: 0, claimCheckedNumbers: 0, claimIdsTruncated: 0 },
    })
    const news = [
      { id: 'n1', title: 'T1', url: 'https://example.com/n1', text: 'b1' },
      { id: 'n2', title: 'T2', url: 'https://example.com/n2', text: 'b2' },
      { id: 'n3', title: 'T3', url: 'https://example.com/n3', text: 'b3' },
    ]
    const metadata: RunMetadata = { llmCalls: [], totalCostUsd: 0, totalLatencyMs: 0 }
    const brief = await runDailyBrief({ news, date: '2026-04-29', metadata })
    expect(brief.newsTitlesById).toEqual({ n1: 'T1', n3: 'T3' }) // n2 不在
  })
})

// ★★ 報告日是**承載值**——檢索窗的上界錨在它，錯了的表現與正確時一模一樣
//    （報告照產、citation 照掛、CI 全綠）。這一組守的是「每個入口把**自己那個**報告日
//    傳到底」，不是「有傳」。第 2 輪驗收實測：**這四個跳點**改成
//    `taipeiDateOf(new Date())` 時，沒有這一組就全綠——`orchestrator.ts` 的
//    `attachTier2Chains({ reportDate: p.date })`（runDailyBrief 的二階）、
//    runAnalystOnly 那一跳、runSingleNews 的一階與二階。
//    （`runDailyBrief` 的**一階**不在這四個裡：它由本檔上面那條
//    `expect(...mock.calls.map(c => c[0]?.reportDate)).toEqual([...])` 蓋住，
//    第 5 輪驗收實測拿掉這一組之後改它仍會紅。`analyze-worker.ts:196` 由
//    `analyze-worker.test.ts` 的同款斷言守。）
//    ★ 二階那一跳一度被註解宣稱「由 tier2-fanout.test.ts 顧」，但那支釘的是
//    `runTier2Fanout` **內部**用自己的 `p.reportDate`，釘不到呼叫端傳什麼。
describe('報告日 threading 的值', () => {
  // tier 1 回一條帶 nextTierEntities 的鏈，二階才會真的跑到 retriever
  const TIER1_WITH_FANOUT = {
    primaryImpact: 'p',
    reasoning: 'r',
    claims: [],
    cascadeChains: [{ industry: 'i', mechanism: 'm', affectedTickers: [], direction: 'neutral' as const, citations: [], nextTierEntities: ['ASML'] }],
  }

  function reportDatesSeen(): string[] {
    return vi.mocked(retrieverMod.retrieveArticles).mock.calls.map(c => c[0]?.reportDate ?? '(missing)')
  }

  beforeEach(() => {
    // 呼叫紀錄跨 it 累積，這一組是逐次比對 reportDate 的集合，不清會讀到上一條的值
    vi.clearAllMocks()
    // ★ 自己 stub Stage 0，不要靠兄弟 describe 殘留的 mock。第 3 輪驗收實測：
    //   少了這行，`vitest run ... -t '報告日 threading'` 單獨跑會炸在 orchestrator.ts:170-171
    //   （`Cannot read properties of undefined (reading 'catch')`）——那條測試原本是
    //   靠執行順序巧合過的。
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
    vi.mocked(narrativeWriterMod.callNarrativeWriter).mockResolvedValue({
      narrative: null,
      audit: { failed: false, retryReason: null, fabricationStripped: 0, claimIdsStripped: 0, claimCitationUrlsDropped: 0, claimCitationSections: 0, claimUnboundNumbers: 0, claimCheckedNumbers: 0, claimIdsTruncated: 0 },
    })
    vi.mocked(viewpointsMod.runViewpointsDebate).mockResolvedValue(null)
    vi.mocked(decomposerMod.callDecomposer).mockResolvedValue({
      primaryEntity: { name: 'X', kind: 'company' },
      topicTags: [],
      cascadeHypotheses: [{ industry: 'i', mechanism: 'm', retrieveQuery: { entities: ['X'], days: 7 } }],
    })
    // 回 [] 就好：二階拿到空結果會提早結束，但那次 retrieve **已經發生**，
    // 這一組要驗的正是那次呼叫帶了什麼報告日。
    vi.mocked(retrieverMod.retrieveArticles).mockResolvedValue([])
    vi.mocked(analystMod.callAnalystTier1).mockResolvedValue(TIER1_WITH_FANOUT)
    vi.mocked(synthesizerMod.callSynthesizer).mockResolvedValue(validSynthMock)
  })

  it('runDailyBrief：一階與二階的檢索都用 p.date', async () => {
    const metadata: RunMetadata = { llmCalls: [], totalCostUsd: 0, totalLatencyMs: 0 }
    await runDailyBrief({
      news: [
        { id: 'n1', title: 'T1', url: 'https://e.com/1', text: 'b1', publishedAt: null },
        { id: 'n2', title: 'T2', url: 'https://e.com/2', text: 'b2', publishedAt: null },
      ],
      date: '2026-04-25',
      metadata,
    })
    const seen = reportDatesSeen()
    expect(seen.length).toBeGreaterThanOrEqual(4) // 2 news × (一階 + 二階)
    expect([...new Set(seen)]).toEqual(['2026-04-25'])
  })

  it('runSingleNews：一階與二階的檢索都用 p.briefDate', async () => {
    const metadata: RunMetadata = { llmCalls: [], totalCostUsd: 0, totalLatencyMs: 0 }
    await runSingleNews({ input: { title: 'T', text: 'b' }, briefDate: '2026-05-01', metadata })
    const seen = reportDatesSeen()
    expect(seen.length).toBeGreaterThanOrEqual(2)
    expect([...new Set(seen)]).toEqual(['2026-05-01'])
  })

  it('runAnalystOnly：二階的檢索用 p.briefDate', async () => {
    const metadata: RunMetadata = { llmCalls: [], totalCostUsd: 0, totalLatencyMs: 0 }
    await runAnalystOnly({
      input: { title: 'T', text: 'B' },
      inputCanonical: ['fed'],
      priorChains: [],
      briefDate: '2026-05-02',
      metadata,
    })
    const seen = reportDatesSeen()
    expect(seen.length).toBeGreaterThanOrEqual(1)
    expect([...new Set(seen)]).toEqual(['2026-05-02'])
  })
})
