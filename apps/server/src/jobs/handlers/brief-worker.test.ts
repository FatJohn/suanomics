import type { MarketBrief } from '@suanomics/shared'
import * as newsRepo from '@suanomics/db/repos/news-repo'
import * as storylinesRepo from '@suanomics/db/repos/storylines-repo'
import { AnalyzePayloadSchema } from '@suanomics/jobs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as editor from '../../agents/editor.js'
import * as orchestrator from '../../agents/orchestrator.js'
import * as context from '../../market-data/context.js'
import { processBriefJob } from './brief-worker.js'

vi.mock('../../agents/orchestrator.js')
vi.mock('../../agents/editor.js')
vi.mock('@suanomics/db/repos/news-repo')
vi.mock('@suanomics/db/repos/storylines-repo')
vi.mock('../../market-data/context.js')

// 候選新聞（getRelevanceCandidates shape：含 contentText + category + publishedAt + fetchedAt + sourceSlug）— editor 從這池子選稿。
// 注：三則同日無實體、rankAndSelect 後 score 全等、僅靠 id 升序 tiebreak 排序。本檔測 editor 選稿/接線、
// 不測 ranker 評分邏輯（評分正確性由 news-relevance.test.ts 覆蓋）。
const sampleCandidates = [
  { id: 1, title: 'T1', contentText: 'body one long enough text', category: 'macro', publishedAt: new Date('2026-06-12T00:00:00Z'), fetchedAt: new Date('2026-06-12T00:00:00Z'), sourceSlug: 'cnbc-markets' },
  { id: 2, title: 'T2', contentText: 'body two long enough text', category: 'tw-equity-other', publishedAt: new Date('2026-06-12T00:00:00Z'), fetchedAt: new Date('2026-06-12T00:00:00Z'), sourceSlug: 'cna' },
  { id: 3, title: 'T3', contentText: 'body three long enough text', category: 'macro', publishedAt: new Date('2026-06-12T00:00:00Z'), fetchedAt: new Date('2026-06-12T00:00:00Z'), sourceSlug: 'ltn-business' },
] as never

function firstRunDailyBriefArg(): orchestrator.RunDailyBriefParams {
  const call = vi.mocked(orchestrator.runDailyBrief).mock.calls[0]
  if (!call)
    throw new Error('runDailyBrief was not called')
  return call[0]
}

function firstInvocationOrder(fn: { mock: { invocationCallOrder: number[] } }): number {
  const order = fn.mock.invocationCallOrder[0]
  if (order === undefined)
    throw new Error('expected at least one invocation')
  return order
}

function stubEditorFallbackByDefault() {
  // 預設讓 editor 路徑失敗 → 既有測試走 selectNewsForBrief recency fallback、行為不變
  vi.mocked(editor.callEditor).mockRejectedValue(new Error('editor disabled by default'))
  vi.mocked(newsRepo.getRelevanceCandidates).mockResolvedValue(sampleCandidates)
  vi.mocked(newsRepo.getRecentBriefSummaries).mockResolvedValue([])
  vi.mocked(storylinesRepo.getOpenStorylines).mockResolvedValue([])
  vi.mocked(storylinesRepo.applyEditorResult).mockResolvedValue({ touched: 0, created: 0, dormanted: 0, resolved: 0, openCap: 10 })
  vi.mocked(context.loadMarketContext).mockResolvedValue({ snapshotBlock: null, calendarBlock: null, taiexCloseDate: null })
}

const sampleNews = [
  { id: 1, title: 'T1', url: 'https://example.com/1', text: 'b1' },
  { id: 2, title: 'T2', url: 'https://example.com/2', text: 'b2' },
  { id: 3, title: 'T3', url: 'https://example.com/3', text: 'b3' },
]

// Partial mock — omits optional fields not needed for unit tests
const sampleBrief = {
  headline: 'h',
  summary: 's',
  relatedNews: [],
  affectedIndustries: [],
  relatedETFs: [],
  reasoningChain: ['r1', 'r2'],
  citations: [{ url: 'https://x/1', title: 't', quote: 'q' }],
  disclaimer: '本分析僅供參考、非投資建議、實際投資請諮詢專業人士',
} as unknown as MarketBrief

describe('processBriefJob', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    stubEditorFallbackByDefault()
  })

  it('should select news, run runDailyBrief, save daily brief, return briefId + metadata', async () => {
    vi.mocked(newsRepo.selectNewsForBrief).mockResolvedValue(sampleNews)
    vi.mocked(orchestrator.runDailyBrief).mockResolvedValue(sampleBrief)
    vi.mocked(newsRepo.saveDailyBrief).mockResolvedValue(42)

    const updateProgress = vi.fn()
    const enqueue = vi.fn(async () => ({ auditId: 'a', status: 'queued' as const }))
    const result = await processBriefJob({ payload: { date: '2026-04-24' }, updateProgress, enqueue: enqueue as never })

    expect(orchestrator.runDailyBrief).toHaveBeenCalledTimes(1)
    // saveDailyBrief 多吃第 4 arg briefJson (full MarketBrief)
    expect(newsRepo.saveDailyBrief).toHaveBeenCalledWith('2026-04-24', [1, 2, 3], expect.stringContaining('h'), expect.any(Object))
    expect(result.briefId).toBe(42)
    expect(result.metadata.totalCostUsd).toBeGreaterThanOrEqual(0)
    expect(updateProgress).toHaveBeenCalledWith(10)
    expect(updateProgress).toHaveBeenCalledWith(90)
    expect(updateProgress).toHaveBeenCalledWith(100)
  })

  it('pre-enqueues analyze job for each selected news (with newsItemId, padded content) so daily brief 列表點下去就有 cache', async () => {
    vi.mocked(newsRepo.selectNewsForBrief).mockResolvedValue(sampleNews)
    vi.mocked(orchestrator.runDailyBrief).mockResolvedValue(sampleBrief)
    vi.mocked(newsRepo.saveDailyBrief).mockResolvedValue(43)
    const enqueue = vi.fn(async () => ({ auditId: 'a', status: 'queued' as const }))

    await processBriefJob({ payload: { date: '2026-04-24' }, enqueue: enqueue as never })

    // 3 analyze + 1 podcast-generate (chainPodcast 預設 true)
    expect(enqueue).toHaveBeenCalledTimes(4)
    for (const n of sampleNews) {
      expect(enqueue).toHaveBeenCalledWith('analyze', expect.objectContaining({
        title: n.title,
        newsItemId: n.id,
      }))
    }
    // content 應已 pad 到 ≥20 字、否則 AnalyzePayloadSchema 會 reject
    const calls = (enqueue.mock.calls as [string, { content: string }][]).filter(([k]) => k === 'analyze')
    for (const c of calls)
      expect(c[1].content.length).toBeGreaterThanOrEqual(20)
  })

  // 這裡是 analyze 的第二個生產者，而它的 enqueue 包在只 console.warn 的 catch 裡：
  // payload 少一個必填欄位不會讓 brief 失敗，只會讓預跑分析靜默消失。
  // 所以要同時驗「payload 真的通得過 schema」與「reportDate 是這份 brief 的日子、不是今天」。
  it('pre-enqueued analyze payload carries the brief date and passes AnalyzePayloadSchema', async () => {
    // sampleNews 的標題只有兩個字元、過不了 schema 的 title.min(3)，
    // 而本測試要驗的正是「payload 真的通得過 schema」，所以這裡用長度像真的標題。
    const realisticNews = sampleNews.map(n => ({ ...n, title: `${n.title} 台股大盤走勢` }))
    vi.mocked(newsRepo.selectNewsForBrief).mockResolvedValue(realisticNews)
    vi.mocked(orchestrator.runDailyBrief).mockResolvedValue(sampleBrief)
    vi.mocked(newsRepo.saveDailyBrief).mockResolvedValue(43)
    const enqueue = vi.fn(async () => ({ auditId: 'a', status: 'queued' as const }))

    await processBriefJob({ payload: { date: '2026-04-24' }, enqueue: enqueue as never })

    const analyzeCalls = (enqueue.mock.calls as [string, unknown][]).filter(([k]) => k === 'analyze')
    expect(analyzeCalls.length).toBeGreaterThan(0)
    for (const [, payload] of analyzeCalls) {
      const parsed = AnalyzePayloadSchema.parse(payload)
      expect(parsed.reportDate).toBe('2026-04-24')
    }
  })

  it('individual enqueue analyze failures do NOT fail the daily brief job', async () => {
    vi.mocked(newsRepo.selectNewsForBrief).mockResolvedValue(sampleNews)
    vi.mocked(orchestrator.runDailyBrief).mockResolvedValue(sampleBrief)
    vi.mocked(newsRepo.saveDailyBrief).mockResolvedValue(44)
    const enqueue = vi.fn(async () => {
      throw new Error('db blip')
    })

    const result = await processBriefJob({ payload: { date: '2026-04-24' }, enqueue: enqueue as never })

    expect(result.briefId).toBe(44)
    // 3 analyze + 1 podcast-generate (all throw, all caught — result still succeeds)
    expect(enqueue).toHaveBeenCalledTimes(4)
  })

  it('should throw when no news for date', async () => {
    vi.mocked(newsRepo.selectNewsForBrief).mockResolvedValue([])
    await expect(processBriefJob({ payload: { date: '2026-04-24' } })).rejects.toThrow(/no news/)
    expect(orchestrator.runDailyBrief).not.toHaveBeenCalled()
  })

  it('should propagate ComplianceGateFailedError-like errors without saving', async () => {
    vi.mocked(newsRepo.selectNewsForBrief).mockResolvedValue(sampleNews)
    vi.mocked(orchestrator.runDailyBrief).mockRejectedValue(
      Object.assign(new Error('compliance gate failed'), { name: 'ComplianceGateFailedError' }),
    )
    await expect(processBriefJob({ payload: { date: '2026-04-24' } })).rejects.toThrow(/compliance gate/)
    expect(newsRepo.saveDailyBrief).not.toHaveBeenCalled()
  })
})

describe('processBriefJob — chainPodcast', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    stubEditorFallbackByDefault()
  })

  it('enqueues podcast-generate after success when chainPodcast is true', async () => {
    vi.mocked(newsRepo.selectNewsForBrief).mockResolvedValue(sampleNews)
    vi.mocked(orchestrator.runDailyBrief).mockResolvedValue(sampleBrief)
    vi.mocked(newsRepo.saveDailyBrief).mockResolvedValue(101)
    const enqueue = vi.fn(async () => ({ auditId: 'a', status: 'queued' as const }))

    await processBriefJob({ payload: { date: '2026-05-18', chainPodcast: true }, enqueue: enqueue as never })

    const calls = enqueue.mock.calls as [string, unknown][]
    const podcastCall = calls.find(([k]) => k === 'podcast-generate')
    expect(podcastCall).toBeDefined()
    // eslint-disable-next-line ts/no-non-null-assertion -- toBeDefined() assertion above guarantees podcastCall is non-null
    expect(podcastCall![1]).toEqual({ date: '2026-05-18' })
  })

  it('enqueues podcast-generate when chainPodcast is undefined (default true via schema)', async () => {
    vi.mocked(newsRepo.selectNewsForBrief).mockResolvedValue(sampleNews)
    vi.mocked(orchestrator.runDailyBrief).mockResolvedValue(sampleBrief)
    vi.mocked(newsRepo.saveDailyBrief).mockResolvedValue(102)
    const enqueue = vi.fn(async () => ({ auditId: 'a', status: 'queued' as const }))

    // payload omits chainPodcast — worker treats !== false as chain
    await processBriefJob({ payload: { date: '2026-05-18' } as never, enqueue: enqueue as never })

    const calls = enqueue.mock.calls as [string, unknown][]
    expect(calls.find(([k]) => k === 'podcast-generate')).toBeDefined()
  })

  it('does NOT enqueue podcast-generate when chainPodcast=false', async () => {
    vi.mocked(newsRepo.selectNewsForBrief).mockResolvedValue(sampleNews)
    vi.mocked(orchestrator.runDailyBrief).mockResolvedValue(sampleBrief)
    vi.mocked(newsRepo.saveDailyBrief).mockResolvedValue(103)
    const enqueue = vi.fn(async () => ({ auditId: 'a', status: 'queued' as const }))

    await processBriefJob({ payload: { date: '2026-05-18', chainPodcast: false }, enqueue: enqueue as never })

    const calls = enqueue.mock.calls as [string, unknown][]
    expect(calls.find(([k]) => k === 'podcast-generate')).toBeUndefined()
    // analyze jobs still get enqueued (existing behavior)
    expect(calls.filter(([k]) => k === 'analyze').length).toBe(sampleNews.length)
  })

  it('chain enqueue failure is logged but does NOT fail the brief job', async () => {
    vi.mocked(newsRepo.selectNewsForBrief).mockResolvedValue(sampleNews)
    vi.mocked(orchestrator.runDailyBrief).mockResolvedValue(sampleBrief)
    vi.mocked(newsRepo.saveDailyBrief).mockResolvedValue(104)
    const enqueue = vi.fn(async (kind: string) => {
      if (kind === 'podcast-generate')
        throw new Error('db blip')
      return { auditId: 'a', status: 'queued' as const }
    })

    const result = await processBriefJob({ payload: { date: '2026-05-18', chainPodcast: true }, enqueue: enqueue as never })
    expect(result.briefId).toBe(104)
  })

  it('failure path does NOT chain podcast-generate', async () => {
    vi.mocked(newsRepo.selectNewsForBrief).mockResolvedValue(sampleNews)
    vi.mocked(orchestrator.runDailyBrief).mockRejectedValue(new Error('LLM down'))
    const enqueue = vi.fn(async () => ({ auditId: 'a', status: 'queued' as const }))

    await expect(processBriefJob({ payload: { date: '2026-05-18', chainPodcast: true }, enqueue: enqueue as never }))
      .rejects
      .toThrow(/LLM down/)
    const calls = enqueue.mock.calls as [string, unknown][]
    expect(calls.find(([k]) => k === 'podcast-generate')).toBeUndefined()
  })
})

describe('processBriefJob — editor selection + storyline writeback', () => {
  const openLine = {
    id: 7,
    title: 'Fed 升息路徑',
    thesis: 'Fed 將維持高利率',
    status: 'open' as const,
    entities: ['Fed'],
    createdAt: '2026-06-10',
    updates: [],
  }

  // editor 從候選只選 id 1 + 2、touch 既有線 7、提出一條新線
  const editorOutput = {
    mainThemes: ['利率'],
    dailyThesis: '聯準會政策與市場預期拉鋸決定今日走向',
    selectedNewsIds: [1, 2],
    storylineTouches: [{ storylineId: 7, valence: 'extend' as const, note: '今日 Fed 官員放鷹' }],
    resolveStorylines: [],
    newStorylines: [{ title: '新線', thesis: '新論點', entities: ['X'] }],
  }

  // callEditor 現在回兩層 contract。fixture 仍以扁平形狀描述、由本 helper 轉成回傳形狀。
  const asEditorResult = (o: typeof editorOutput) => ({
    selection: { mainThemes: o.mainThemes, dailyThesis: o.dailyThesis, selectedNewsIds: o.selectedNewsIds },
    storyline: { storylineTouches: o.storylineTouches, resolveStorylines: o.resolveStorylines, newStorylines: o.newStorylines },
    schemaDroppedEntries: 0,
  })

  beforeEach(() => {
    vi.resetAllMocks()
    stubEditorFallbackByDefault()
    vi.mocked(orchestrator.runDailyBrief).mockResolvedValue(sampleBrief)
    vi.mocked(newsRepo.saveDailyBrief).mockResolvedValue(200)
  })

  // ── 重大公告保留席 ─────────────────────────────
  // 公告是候選池裡的一則真候選（`cbc-press` 已進 news_sources），所以它有真的
  // news_items id——這正是第一版負數 id 撞壞的兩件事（analyze payload 的 .positive()、
  // selected_news_ids 的 inArray 查詢）現在不會發生的原因。
  const cbcDecision = {
    id: 9001,
    title: '中央銀行理監事聯席會議決議新聞稿',
    url: 'https://www.cbc.gov.tw/tw/cp-302-1.html',
    contentText: '本行理監事會決議調升政策利率半碼，並維持選擇性信用管制措施。',
    category: 'macro',
    publishedAt: new Date('2026-06-11T08:23:00Z'), // 台北 06-11 16:23、報告日 06-12 的窗內
    fetchedAt: new Date('2026-06-11T09:00:00Z'),
    sourceSlug: 'cbc-press',
  }
  function poolOf(n: number, extra: unknown[] = []) {
    const many = Array.from({ length: n }, (_, i) => ({
      id: i + 1,
      title: `T${i + 1}`,
      url: `https://x/${i + 1}`,
      contentText: `body ${i + 1} long enough text`,
      category: i % 2 === 0 ? 'macro' : 'tw-equity-other',
      publishedAt: new Date('2026-06-12T00:00:00Z'),
      fetchedAt: new Date('2026-06-12T00:00:00Z'),
      sourceSlug: 'cna',
    }))
    return [...extra, ...many] as never
  }

  it('有重大公告時：它排在 news 最前面、候選只吃剩下的格數、且不會被 ranker 重複選一次', async () => {
    vi.mocked(newsRepo.getRelevanceCandidates).mockResolvedValue(poolOf(41, [cbcDecision]))
    vi.mocked(editor.callEditor).mockResolvedValue(asEditorResult(editorOutput))
    const enqueue = vi.fn(async () => ({ auditId: 'a', status: 'queued' as const }))

    await processBriefJob({ payload: { date: '2026-06-12' }, enqueue: enqueue as never })

    const editorArg = vi.mocked(editor.callEditor).mock.calls[0]?.[0]
    expect(editorArg?.candidates.length).toBe(35) // TOP_K 36 − 1 格保留席
    const news = firstRunDailyBriefArg().news
    expect(news[0]?.title).toBe('中央銀行理監事聯席會議決議新聞稿')
    expect(news[0]?.url).toBe('https://www.cbc.gov.tw/tw/cp-302-1.html')
    expect(news[0]?.id).toBe('9001')
  })

  // ★ 池子必須小到「不濾就一定重複」：41 則的池子裡 cbc 本來就排不進前 35 名，
  //   那樣的斷言是 fixture 巧合——第二輪驗收實測拿掉 `pool.filter` 之後 32 條測試全綠。
  //   6 則候選全部進得了 topK=35，所以這條才真的釘得住。
  it('保留席那則從候選池抽走：editor 看不到它，不會被選第二次', async () => {
    vi.mocked(newsRepo.getRelevanceCandidates).mockResolvedValue(poolOf(5, [cbcDecision]))
    vi.mocked(editor.callEditor).mockResolvedValue(asEditorResult(editorOutput))
    const enqueue = vi.fn(async () => ({ auditId: 'a', status: 'queued' as const }))

    await processBriefJob({ payload: { date: '2026-06-12' }, enqueue: enqueue as never })

    const editorArg = vi.mocked(editor.callEditor).mock.calls[0]?.[0]
    expect(editorArg?.candidates.length).toBe(5) // 6 則池子 − 1 格保留席
    expect(editorArg?.candidates.some(c => c.id === 9001)).toBe(false)
  })

  // ★ 這條釘的是第二輪驗收抓到的新缺陷：降級路徑的 selectNewsForBrief 是獨立的 recency
  //   查詢、不知道保留席，不濾就會同一則進兩次（實測 news ids = ["9001","9001","1"]）。
  it('降級路徑：保留席那則不會與 recency 選稿重複', async () => {
    vi.mocked(newsRepo.getRelevanceCandidates).mockResolvedValue(poolOf(5, [cbcDecision]))
    vi.mocked(editor.callEditor).mockRejectedValue(new Error('llm down'))
    vi.mocked(newsRepo.selectNewsForBrief).mockResolvedValue([
      { id: 9001, title: '中央銀行理監事聯席會議決議新聞稿', url: 'https://www.cbc.gov.tw/tw/cp-302-1.html', text: '本行理監事會決議調升政策利率半碼。' },
      { id: 1, title: 'T1', url: 'https://x/1', text: 'body one long enough text' },
    ] as never)
    const enqueue = vi.fn(async () => ({ auditId: 'a', status: 'queued' as const }))

    await processBriefJob({ payload: { date: '2026-06-12' }, enqueue: enqueue as never })

    const ids = firstRunDailyBriefArg().news.map(n => n.id)
    expect(ids).toEqual(['9001', '1'])
    expect(vi.mocked(newsRepo.saveDailyBrief).mock.calls[0]?.[1]).toEqual([9001, 1])
  })

  // ★ 這條在保留席那次重寫測試時被誤刪、接線回到零覆蓋（第二輪驗收抓到）。
  //   loadMarketContext 的 mock 都不帶這個欄位，而 tsconfig 排除 *.test.ts、型別也擋不到。
  it('把 officialBlock 從 market context 傳給 editor', async () => {
    vi.mocked(context.loadMarketContext).mockResolvedValue({
      snapshotBlock: null,
      calendarBlock: null,
      officialBlock: '- 2026-06-12（央行）115年5月金融情況',
      taiexCloseDate: null,
    } as unknown as Awaited<ReturnType<typeof context.loadMarketContext>>)
    vi.mocked(editor.callEditor).mockResolvedValue(asEditorResult(editorOutput))
    const enqueue = vi.fn(async () => ({ auditId: 'a', status: 'queued' as const }))

    await processBriefJob({ payload: { date: '2026-06-12' }, enqueue: enqueue as never })

    expect(editor.callEditor).toHaveBeenCalledWith(
      expect.objectContaining({ officialBlock: '- 2026-06-12（央行）115年5月金融情況' }),
    )
  })

  // ★ 這條釘的是第一版被獨立複查抓到的實際回歸：負數 id 會讓
  //   AnalyzePayloadSchema 的 .positive() 擋下，而錯誤被 catch 吞成 warn——
  //   頭條那則永遠沒有預跑分析，而且沒有任何測試會紅。
  it('保留席那則的 analyze payload 通過 AnalyzePayloadSchema（負數 id 的回歸守門）', async () => {
    vi.mocked(newsRepo.getRelevanceCandidates).mockResolvedValue(poolOf(5, [cbcDecision]))
    vi.mocked(editor.callEditor).mockResolvedValue(asEditorResult(editorOutput))
    const enqueue = vi.fn(async () => ({ auditId: 'a', status: 'queued' as const }))

    await processBriefJob({ payload: { date: '2026-06-12' }, enqueue: enqueue as never })

    const payloads = enqueue.mock.calls.filter(c => c[0] === 'analyze').map(c => c[1])
    const reservedPayload = payloads.find(pl => (pl as { newsItemId?: number }).newsItemId === 9001)
    expect(reservedPayload).toBeDefined()
    expect(AnalyzePayloadSchema.safeParse(reservedPayload).success).toBe(true)
  })

  it('保留席那則的 id 會進 selected_news_ids（讀者面靠它查回新聞）', async () => {
    vi.mocked(newsRepo.getRelevanceCandidates).mockResolvedValue(poolOf(5, [cbcDecision]))
    vi.mocked(editor.callEditor).mockResolvedValue(asEditorResult(editorOutput))
    const enqueue = vi.fn(async () => ({ auditId: 'a', status: 'queued' as const }))

    await processBriefJob({ payload: { date: '2026-06-12' }, enqueue: enqueue as never })

    const savedIds = vi.mocked(newsRepo.saveDailyBrief).mock.calls[0]?.[1]
    expect(savedIds).toContain(9001)
    expect((savedIds ?? []).every(id => id > 0)).toBe(true)
  })

  it('沒有重大公告時：候選吃滿 TOP_K', async () => {
    vi.mocked(newsRepo.getRelevanceCandidates).mockResolvedValue(poolOf(41))
    vi.mocked(editor.callEditor).mockResolvedValue(asEditorResult(editorOutput))
    const enqueue = vi.fn(async () => ({ auditId: 'a', status: 'queued' as const }))

    await processBriefJob({ payload: { date: '2026-06-12' }, enqueue: enqueue as never })

    expect(vi.mocked(editor.callEditor).mock.calls[0]?.[0]?.candidates.length).toBe(36)
  })

  it('例行月報不佔保留席（判準窄、寧可漏不誤傷）', async () => {
    vi.mocked(newsRepo.getRelevanceCandidates).mockResolvedValue(
      poolOf(41, [{ ...cbcDecision, title: '115年5月金融情況' }]),
    )
    vi.mocked(editor.callEditor).mockResolvedValue(asEditorResult(editorOutput))
    const enqueue = vi.fn(async () => ({ auditId: 'a', status: 'queued' as const }))

    await processBriefJob({ payload: { date: '2026-06-12' }, enqueue: enqueue as never })

    expect(vi.mocked(editor.callEditor).mock.calls[0]?.[0]?.candidates.length).toBe(36)
    expect(firstRunDailyBriefArg().news[0]?.title).not.toBe('115年5月金融情況')
  })

  it('取候選池失敗不擋 brief：退回沒有保留席的降級路徑', async () => {
    vi.mocked(newsRepo.getRelevanceCandidates).mockRejectedValue(new Error('db down'))
    vi.mocked(newsRepo.selectNewsForBrief).mockResolvedValue([
      { id: 1, title: 'T1', url: 'https://x/1', text: 'body one long enough text' },
    ] as never)
    const enqueue = vi.fn(async () => ({ auditId: 'a', status: 'queued' as const }))

    await processBriefJob({ payload: { date: '2026-06-12' }, enqueue: enqueue as never })

    expect(orchestrator.runDailyBrief).toHaveBeenCalled()
    expect(firstRunDailyBriefArg().news[0]?.title).toBe('T1')
    // ★ 取候選失敗就不該再打 editor：空候選餵 LLM 是白花一次呼叫，而且它會在沒有素材的
    //   情況下硬編。改動前這條路是「getRelevanceCandidates 拋 → 直接落 catch」，把取候選
    //   提到 try 外之後這個等價性只剩一個 `if (poolFailed) throw` 撐著——第三輪驗收實測
    //   刪掉那兩行 35 條測試全綠，所以這條斷言是它唯一的守門。
    expect(editor.callEditor).not.toHaveBeenCalled()
  })

  it('editor 掛掉走降級時、保留席仍然在最前面', async () => {
    vi.mocked(newsRepo.getRelevanceCandidates).mockResolvedValue(poolOf(5, [cbcDecision]))
    vi.mocked(editor.callEditor).mockRejectedValue(new Error('llm down'))
    vi.mocked(newsRepo.selectNewsForBrief).mockResolvedValue([
      { id: 1, title: 'T1', url: 'https://x/1', text: 'body one long enough text' },
    ] as never)
    const enqueue = vi.fn(async () => ({ auditId: 'a', status: 'queued' as const }))

    await processBriefJob({ payload: { date: '2026-06-12' }, enqueue: enqueue as never })

    expect(firstRunDailyBriefArg().news[0]?.title).toBe('中央銀行理監事聯席會議決議新聞稿')
  })

  it('editor 成功：runDailyBrief 收到 editor 選的 news 子集 + 非 null storylineBlock；applyEditorResult 在 save 後被呼叫', async () => {
    vi.mocked(storylinesRepo.getOpenStorylines).mockResolvedValue([openLine])
    vi.mocked(editor.callEditor).mockResolvedValue(asEditorResult(editorOutput))
    const enqueue = vi.fn(async () => ({ auditId: 'a', status: 'queued' as const }))

    await processBriefJob({ payload: { date: '2026-06-12' }, enqueue: enqueue as never })

    // 只選了 id 1 + 2（候選有 3 則）
    const runArg = firstRunDailyBriefArg()
    expect(runArg.news.map(n => n.id)).toEqual(['1', '2'])
    // touch 了既有線 → storylineBlock 非 null、含線 title
    expect(runArg.storylineBlock).toBeTruthy()
    expect(runArg.storylineBlock).toContain('Fed 升息路徑')

    // applyEditorResult 在 saveDailyBrief 之後、參數含 touches/newStorylines/resolves/briefDate
    expect(storylinesRepo.applyEditorResult).toHaveBeenCalledWith({
      briefDate: '2026-06-12',
      touches: editorOutput.storylineTouches,
      resolves: [],
      newStorylines: editorOutput.newStorylines,
    })
    const saveOrder = firstInvocationOrder(vi.mocked(newsRepo.saveDailyBrief))
    const applyOrder = firstInvocationOrder(vi.mocked(storylinesRepo.applyEditorResult))
    expect(applyOrder).toBeGreaterThan(saveOrder)
    // saveDailyBrief 拿到 editor 選的 id 子集
    expect(newsRepo.saveDailyBrief).toHaveBeenCalledWith('2026-06-12', [1, 2], expect.any(String), expect.any(Object))

    // editor 的 mainThemes 應接到 runDailyBrief
    expect(firstRunDailyBriefArg().mainThemes).toEqual(editorOutput.mainThemes)
    // dailyThesis 也要接到——這條原本沒有斷言，2026-09-08 突變測試（拿掉展開）35 條全綠才補
    expect(firstRunDailyBriefArg().dailyThesis).toEqual(editorOutput.dailyThesis)
    // touch 既有線 → continuityHint 非 null、含線 title
    expect(firstRunDailyBriefArg().continuityHint).toContain('Fed 升息路徑')
  })

  it('editor fallback 時 runDailyBrief 不帶 mainThemes（undefined）', async () => {
    vi.mocked(editor.callEditor).mockRejectedValue(new Error('gemini down'))
    vi.mocked(newsRepo.selectNewsForBrief).mockResolvedValue(sampleNews)
    const enqueue = vi.fn(async () => ({ auditId: 'a', status: 'queued' as const }))
    await processBriefJob({ payload: { date: '2026-06-12' }, enqueue: enqueue as never })
    expect(firstRunDailyBriefArg().mainThemes).toBeUndefined()
  })

  it('editor 選稿順序 load-bearing：editor 回 [2,1]（候選序 [1,2,3]）→ runDailyBrief 收到 [\'2\',\'1\']', async () => {
    vi.mocked(storylinesRepo.getOpenStorylines).mockResolvedValue([openLine])
    // editor 把 id 2 排在 id 1 前面（主軸排前）、順序須流經 orchestrator → narrative
    vi.mocked(editor.callEditor).mockResolvedValue(asEditorResult({ ...editorOutput, selectedNewsIds: [2, 1] }))
    const enqueue = vi.fn(async () => ({ auditId: 'a', status: 'queued' as const }))

    await processBriefJob({ payload: { date: '2026-06-12' }, enqueue: enqueue as never })

    const runArg = firstRunDailyBriefArg()
    expect(runArg.news.map(n => n.id)).toEqual(['2', '1'])
  })

  it('editor throw → fallback selectNewsForBrief、storylineBlock null、applyEditorResult 不被呼叫', async () => {
    vi.mocked(editor.callEditor).mockRejectedValue(new Error('gemini down'))
    vi.mocked(newsRepo.selectNewsForBrief).mockResolvedValue(sampleNews)
    const enqueue = vi.fn(async () => ({ auditId: 'a', status: 'queued' as const }))

    const result = await processBriefJob({ payload: { date: '2026-06-12' }, enqueue: enqueue as never })

    expect(newsRepo.selectNewsForBrief).toHaveBeenCalledWith('2026-06-12')
    const runArg = firstRunDailyBriefArg()
    expect(runArg.storylineBlock).toBeNull()
    expect(storylinesRepo.applyEditorResult).not.toHaveBeenCalled()
    expect(result.briefId).toBe(200)
  })

  // 選稿層垮掉不再連帶丟掉敘事線寫回
  it('sanitize 後 ok:false（幻覺 id）→ 選稿 fallback、但 storyline 照常寫回', async () => {
    vi.mocked(storylinesRepo.getOpenStorylines).mockResolvedValue([openLine])
    // selectedNewsIds 全是不存在的 id → sanitize 後剩 0 則 → ok:false
    vi.mocked(editor.callEditor).mockResolvedValue(asEditorResult({ ...editorOutput, selectedNewsIds: [999, 998] }))
    vi.mocked(newsRepo.selectNewsForBrief).mockResolvedValue(sampleNews)
    const enqueue = vi.fn(async () => ({ auditId: 'a', status: 'queued' as const }))

    await processBriefJob({ payload: { date: '2026-06-12' }, enqueue: enqueue as never })

    expect(newsRepo.selectNewsForBrief).toHaveBeenCalledWith('2026-06-12')
    const runArg = firstRunDailyBriefArg()
    // 選稿與 fallback 對不上、故不餵 narrative 敘事線脈絡（避免談到今天沒報的線）
    expect(runArg.storylineBlock).toBeNull()
    expect(runArg.continuityHint).toBeNull()
    expect(runArg.mainThemes).toBeUndefined()
    // 但 editor 對敘事線的判斷仍進 DB
    expect(storylinesRepo.applyEditorResult).toHaveBeenCalledWith({
      briefDate: '2026-06-12',
      touches: editorOutput.storylineTouches,
      resolves: [],
      newStorylines: editorOutput.newStorylines,
    })
  })

  it('選稿層不合 schema（selection null）→ 選稿 fallback、但 storyline 照常寫回', async () => {
    vi.mocked(storylinesRepo.getOpenStorylines).mockResolvedValue([openLine])
    vi.mocked(editor.callEditor).mockResolvedValue({
      selection: null,
      storyline: { storylineTouches: editorOutput.storylineTouches, resolveStorylines: [], newStorylines: editorOutput.newStorylines },
      schemaDroppedEntries: 0,
    })
    vi.mocked(newsRepo.selectNewsForBrief).mockResolvedValue(sampleNews)
    const enqueue = vi.fn(async () => ({ auditId: 'a', status: 'queued' as const }))

    await processBriefJob({ payload: { date: '2026-06-12' }, enqueue: enqueue as never })

    expect(newsRepo.selectNewsForBrief).toHaveBeenCalledWith('2026-06-12')
    expect(storylinesRepo.applyEditorResult).toHaveBeenCalledWith(expect.objectContaining({
      touches: editorOutput.storylineTouches,
      newStorylines: editorOutput.newStorylines,
    }))
  })

  // 反方向：storyline 層垮掉不拖累選稿
  it('storyline 層全空 → 選稿仍走 editor、不誤觸 recency fallback', async () => {
    vi.mocked(storylinesRepo.getOpenStorylines).mockResolvedValue([openLine])
    vi.mocked(editor.callEditor).mockResolvedValue({
      selection: { mainThemes: editorOutput.mainThemes, dailyThesis: editorOutput.dailyThesis, selectedNewsIds: [1, 2] },
      storyline: { storylineTouches: [], resolveStorylines: [], newStorylines: [] },
      schemaDroppedEntries: 0,
    })
    const enqueue = vi.fn(async () => ({ auditId: 'a', status: 'queued' as const }))

    await processBriefJob({ payload: { date: '2026-06-12' }, enqueue: enqueue as never })

    expect(newsRepo.selectNewsForBrief).not.toHaveBeenCalled()
    expect(firstRunDailyBriefArg().news.map(n => n.id)).toEqual(['1', '2'])
    expect(firstRunDailyBriefArg().mainThemes).toEqual(editorOutput.mainThemes)
  })

  it('applyEditorResult throw → brief 結果不受影響（不 throw）', async () => {
    vi.mocked(storylinesRepo.getOpenStorylines).mockResolvedValue([openLine])
    vi.mocked(editor.callEditor).mockResolvedValue(asEditorResult(editorOutput))
    vi.mocked(storylinesRepo.applyEditorResult).mockRejectedValue(new Error('db write failed'))
    const enqueue = vi.fn(async () => ({ auditId: 'a', status: 'queued' as const }))

    const result = await processBriefJob({ payload: { date: '2026-06-12' }, enqueue: enqueue as never })

    expect(result.briefId).toBe(200)
  })

  it('selectNewsViaEditor 把分類候選 + market context 傳給 editor', async () => {
    vi.mocked(context.loadMarketContext).mockResolvedValue({ snapshotBlock: 'SNAP', calendarBlock: 'CAL', taiexCloseDate: null })
    vi.mocked(storylinesRepo.getOpenStorylines).mockResolvedValue([openLine])
    vi.mocked(editor.callEditor).mockResolvedValue(asEditorResult(editorOutput))
    const enqueue = vi.fn(async () => ({ auditId: 'a', status: 'queued' as const }))

    await processBriefJob({ payload: { date: '2026-06-12' }, enqueue: enqueue as never })

    const arg = vi.mocked(editor.callEditor).mock.calls[0]?.[0]
    expect(arg?.marketSnapshot).toBe('SNAP')
    expect(arg?.calendarBlock).toBe('CAL')
    expect(arg?.candidates[0]?.category).toBe('macro')
  })

  it('loadMarketContext 失敗時：editor 仍跑、market context degrade 成 null（不誤觸 recency fallback）', async () => {
    vi.mocked(context.loadMarketContext).mockRejectedValue(new Error('market db down'))
    vi.mocked(storylinesRepo.getOpenStorylines).mockResolvedValue([openLine])
    vi.mocked(editor.callEditor).mockResolvedValue(asEditorResult(editorOutput))
    const enqueue = vi.fn(async () => ({ auditId: 'a', status: 'queued' as const }))

    await processBriefJob({ payload: { date: '2026-06-12' }, enqueue: enqueue as never })

    expect(newsRepo.selectNewsForBrief).not.toHaveBeenCalled() // editor path held
    const arg = vi.mocked(editor.callEditor).mock.calls[0]?.[0]
    expect(arg?.marketSnapshot).toBeNull()
    expect(arg?.calendarBlock).toBeNull()
  })
})

describe('processBriefJob 週末 gate', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    stubEditorFallbackByDefault()
  })

  it('週六 → skipped、不跑 runDailyBrief、不 enqueue podcast（gate 在 selectNewsViaEditor 之前、不需 news mock）', async () => {
    const enqueue = vi.fn(async () => ({ auditId: 'a', status: 'queued' as const }))
    const result = await processBriefJob({ payload: { date: '2026-07-11', chainPodcast: true } as never, enqueue: enqueue as never })

    expect(result.skipped).toBe(true)
    expect(orchestrator.runDailyBrief).not.toHaveBeenCalled()
    // gate 在整條 pipeline 最前面提早 return、不會走到任何 enqueue（analyze / podcast-generate 皆不呼叫）
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('假日雙 skip 日回 skipped + skipReason', async () => {
    // 用 Task 2 查證後確定 skip 的真實日期（例：2026-09-28 教師節週一）
    const result = await processBriefJob({ payload: { date: '2026-09-28', chainPodcast: false }, enqueue: vi.fn() as never })
    expect(result.skipped).toBe(true)
    expect(result.skipReason).toBe('holiday-no-material')
  })

  it('週六 skip 帶 skipReason=saturday', async () => {
    const result = await processBriefJob({ payload: { date: '2026-07-11', chainPodcast: false }, enqueue: vi.fn() as never })
    expect(result.skipped).toBe(true)
    expect(result.skipReason).toBe('saturday')
  })

  it('週日 → runDailyBrief 收到 reportKind: weekend（weeklyRecapBlock 依賴 buildWeeklyRecapBlock、本測試固定回 null 走法）', async () => {
    vi.mocked(storylinesRepo.getStorylinesUpdatedInRange).mockResolvedValue([])
    vi.mocked(newsRepo.selectNewsForBrief).mockResolvedValue(sampleNews)
    vi.mocked(orchestrator.runDailyBrief).mockResolvedValue(sampleBrief)
    vi.mocked(newsRepo.saveDailyBrief).mockResolvedValue(300)
    const enqueue = vi.fn(async () => ({ auditId: 'a', status: 'queued' as const }))

    await processBriefJob({ payload: { date: '2026-05-17' }, enqueue: enqueue as never })

    const runArg = firstRunDailyBriefArg()
    expect(runArg.reportKind).toBe('weekend')
  })
})
