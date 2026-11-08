import type { MarketBrief } from '@suanomics/shared'
import type { MarketContext } from '../market-data/context.js'
import type { SeriesAsOfMap } from '../market-data/historical-asof.js'
import type { LlmCallRecord } from './llm-wrapper.js'
import type { RunTier2FanoutParams } from './tier2-fanout.js'
import type { AnalystOutput, CascadeChain, DecomposerOutput } from './types.js'
import { buildClaimLedger } from '@suanomics/shared'
import { pMap, pMapSettled } from '../_p-map.js'
import { assembleDailyBrief } from '../brief/assemble.js'
import { EMPTY_MARKET_CONTEXT, loadMarketContext } from '../market-data/context.js'
import { callAnalystTier1 } from './analyst.js'
import { tagChainForceGroups } from './chain-grouper.js'
import { callDecomposer } from './decomposer.js'
import { ANALYST_TIER1_FANOUT_CONCURRENCY, assertLlmCallBudget, DECOMPOSER_FANOUT_CONCURRENCY, RETRIEVE_FANOUT_CONCURRENCY } from './fanout-concurrency.js'
import { buildMarketCloseFraming } from './market-close-framing.js'
import { callNarrativeWriter } from './narrative-writer.js'
import { retrieveForDecomposed } from './retrieve-for-decomposed.js'
import { callSynthesizer } from './synthesizer.js'
import { runTier2Fanout, stampTier1 } from './tier2-fanout.js'
import { runViewpointsDebate } from './viewpoints-debate.js'

// 既有 callers / test 透過 orchestrator.js 取得 tier 2 helpers、保留 barrel re-export
export { runTier2Fanout, stampTier1 } from './tier2-fanout.js'

export interface RunMetadata {
  llmCalls: LlmCallRecord[]
  totalCostUsd: number
  totalLatencyMs: number
  partialSuccess?: {
    failedNewsIds: string[]
    failedReasons: { newsId: string, error: string }[]
  }
}

export interface NewsItem {
  id: string
  title: string
  url: string
  text: string
  // 時間框架：原始新聞發布時間（UTC ISO）、供 relativeDayLabel 算今日/昨日。缺則 null。
  publishedAt: string | null
}

export interface RunAnalystOnlyParams {
  input: { title: string, text: string, id?: string }
  inputCanonical: string[]
  priorChains: CascadeChain[]
  metadata: RunMetadata
  /** 報告日（台北曆日）。必填：agent 自行現算會把 EvidenceClaim 的 asOf 綁到執行時刻。 */
  briefDate: string
}

// db-related mode：跳 decomposer + retriever、用 heuristic-extract 的
// canonical 拼一個最小 DecomposerOutput shape、把 cached chains 當 prior 餵
// analyst userContent。
export async function runAnalystOnly(p: RunAnalystOnlyParams): Promise<AnalystOutput> {
  const onCall = (r: LlmCallRecord) => {
    p.metadata.llmCalls.push(r)
    p.metadata.totalCostUsd += r.costUsd
    p.metadata.totalLatencyMs += r.latencyMs
  }
  const primaryEntity = { name: p.inputCanonical[0] ?? 'unknown', kind: 'topic' }
  const decomposed: DecomposerOutput = {
    primaryEntity,
    topicTags: p.inputCanonical.slice(0, 5),
    cascadeHypotheses: [],
  }
  const tier1Output = await callAnalystTier1({
    newsTitle: p.input.title,
    newsText: p.input.text,
    ...(p.input.id !== undefined ? { newsId: p.input.id } : {}),
    decomposed,
    retrieved: [],
    priorChains: p.priorChains,
    briefDate: p.briefDate,
    onCallRecord: onCall,
  })

  return attachTier2Chains({
    tier1Output,
    news: { title: p.input.title, text: p.input.text, ...(p.input.id !== undefined ? { id: p.input.id } : {}) },
    reportDate: p.briefDate,
    onCallRecord: onCall,
  })
}

/**
 * tier 1 產出接上 tier 2：蓋 chainId、跑 fanout、把兩階合併成一份 AnalystOutput。
 *
 * 抽成單一入口的理由是那條**沒有型別保證的順序契約**：`runTier2Fanout` 要求
 * `tier1Chains` 必須先過 `stampTier1`，違反時它只印一行 console.warn 然後靜默跳過
 * 整批二階（見 tier2-fanout.ts:44 的自白）。三個入口各自手寫「stamp → fanout → 合併」
 * 就是三次記得的機會；收成一個函式之後，呼叫端根本拿不到沒 stamp 的 chains。
 */
async function attachTier2Chains(p: {
  tier1Output: AnalystOutput
  news: RunTier2FanoutParams['news']
  reportDate: RunTier2FanoutParams['reportDate']
  marketSnapshot?: RunTier2FanoutParams['marketSnapshot']
  onCallRecord: RunTier2FanoutParams['onCallRecord']
}): Promise<AnalystOutput> {
  const tier1Stamped = stampTier1(p.tier1Output.cascadeChains)
  const tier2Chains = await runTier2Fanout({
    news: p.news,
    tier1Chains: tier1Stamped,
    reportDate: p.reportDate,
    ...(p.marketSnapshot === undefined ? {} : { marketSnapshot: p.marketSnapshot }),
    onCallRecord: p.onCallRecord,
  })
  return { ...p.tier1Output, cascadeChains: [...tier1Stamped, ...tier2Chains] }
}

export interface RunDailyBriefParams {
  news: NewsItem[]
  date: string
  metadata: RunMetadata
  loadMarketContext?: () => Promise<MarketContext>
  // editor 算出的跨日敘事線回顧區塊、直通 narrative writer（無進展時為 null）
  storylineBlock?: string | null
  // editor 當日主軸、直通 narrative writer（fallback / 無 editor 時 undefined）
  mainThemes?: string[]
  // editor 本日論點 thesis、直通 narrative writer（fallback / 無 editor 時 undefined）
  dailyThesis?: string
  // top-1 延續主線 hint、直通 synthesizer（標題連續性）；缺則 stateless
  continuityHint?: string | null
  // 週末模式與本週回顧素材、brief-worker 決定後透傳給 narrative-writer
  reportKind?: 'weekday' | 'weekend'
  weeklyRecapBlock?: string | null
  /**
   * 補跑歷史日期時的逐序列 as-of 覆寫，直通 `loadMarketContext`。
   * 不給就是 `processBriefJob` 的正常路徑（全部序列用 reportDate）——
   * 這裡刻意不用 `p.loadMarketContext` 那個注入點達成，那個口子是給測試用的。
   */
  seriesAsOf?: SeriesAsOfMap
}

const MIN_NEWS_FOR_BRIEF = 2

// 檢查點刻意放在「即將展開下一批扇出」之前、不放進 onCall 本身——onCall 是在
// llm-wrapper.ts 的 try/catch 裡被呼叫的，若在那裡 throw 會被當成這次呼叫失敗、
// 觸發 retry（再打一次已經成功的 LLM 請求，反而讓失控更嚴重）。實作見
// fanout-concurrency.ts 的 assertLlmCallBudget；這裡只在每個 stage/fanout 開始前
// 讀 p.metadata.llmCalls.length（onCall 那條既有線在推）餵給它。

// 對 decomposer 輸出的 cascadeHypotheses 做 per-hypothesis 並行 retrieve、
// 容錯（單一 hypothesis 失敗回空集）並 dedupe URL。daily-brief / single-news 兩 path 共用、
// 確保未來在 retriever 之前插 normalize / fuzzy fallback 只改一處。
// daily-brief / single-news 兩 path 共用的 retrieve helper，實作見同名模組。
export { retrieveForDecomposed }

async function decomposeAndFilterNews(
  news: NewsItem[],
  onCall: (r: LlmCallRecord) => void,
): Promise<{
  survivedNews: { news: NewsItem, decomposed: DecomposerOutput }[]
  partialFailed: { newsId: string, error: string }[]
}> {
  // bounded concurrency，Promise.allSettled 的「單一失敗不中斷整批」語意由 pMapSettled
  // 保留（見 fanout-concurrency.ts 的事故脈絡）。
  const decomposed = await pMapSettled(news, DECOMPOSER_FANOUT_CONCURRENCY, n =>
    callDecomposer({ newsTitle: n.title, newsText: n.text, newsId: n.id, onCallRecord: onCall }))

  const partialFailed: { newsId: string, error: string }[] = []
  const survivedNews: { news: NewsItem, decomposed: DecomposerOutput }[] = []
  decomposed.forEach((res, i) => {
    const item = news[i]
    if (!item)
      return
    if (res.status === 'fulfilled')
      survivedNews.push({ news: item, decomposed: res.value })
    else
      partialFailed.push({ newsId: item.id, error: String((res.reason as Error)?.message ?? res.reason) })
  })

  return { survivedNews, partialFailed }
}

export async function runDailyBrief(p: RunDailyBriefParams): Promise<MarketBrief> {
  const onCall = (r: LlmCallRecord) => {
    p.metadata.llmCalls.push(r)
    p.metadata.totalCostUsd += r.costUsd
    p.metadata.totalLatencyMs += r.latencyMs
  }

  // Stage 0：市場數據 context、任何失敗不擋 brief
  const marketCtx = await (p.loadMarketContext ?? (() => loadMarketContext({
    reportDate: p.date,
    ...(p.seriesAsOf === undefined ? {} : { seriesAsOf: p.seriesAsOf }),
  })))()
    .catch((): MarketContext => EMPTY_MARKET_CONTEXT)

  // 台股收盤時間框架：taiexCloseDate 對比報告日 D 算今日/昨日、餵三個 agent。
  const marketCloseFraming = buildMarketCloseFraming(marketCtx.taiexCloseDate, p.date)

  // Stage 1: per-news Decomposer fanout + partial fail filter
  const { survivedNews, partialFailed } = await decomposeAndFilterNews(p.news, onCall)
  assertLlmCallBudget(p.metadata.llmCalls.length)

  if (survivedNews.length < MIN_NEWS_FOR_BRIEF)
    throw new Error(`runDailyBrief: insufficient news survived (${survivedNews.length} < ${MIN_NEWS_FOR_BRIEF})`)

  // Stage 2: per-news Retriever fanout（bounded concurrency，見 RETRIEVE_FANOUT_CONCURRENCY
  // 定義處的事故脈絡；語意不變——任一 news 的 retrieve 失敗仍會讓整批 reject）。
  const retrievedPerNews = await pMap(survivedNews, RETRIEVE_FANOUT_CONCURRENCY, ({ decomposed: dec }) => retrieveForDecomposed(dec, p.date))

  // Stage 3: per-news Analyst batch (tier 1 + tier 2 fanout per news)
  // bounded concurrency，Promise.allSettled 的「單一 news 失敗不中斷整批」語意由
  // pMapSettled 保留（見 fanout-concurrency.ts 的事故脈絡）。
  const analystResults = await pMapSettled(survivedNews, ANALYST_TIER1_FANOUT_CONCURRENCY, async ({ news, decomposed: dec }, i) => {
    // 每個 worker 開始前先查一次：budget 若已在前面的 worker 燒穿，這裡擋住「展開新的
    // tier1+tier2 呼叫鏈」，已經在飛的 worker 不受影響、正常收尾。
    assertLlmCallBudget(p.metadata.llmCalls.length)
    const tier1Output = await callAnalystTier1({
      newsTitle: news.title,
      newsText: news.text,
      newsId: news.id,
      newsUrl: news.url,
      ...(news.publishedAt !== undefined ? { publishedAt: news.publishedAt } : {}),
      briefDate: p.date,
      decomposed: dec,
      retrieved: retrievedPerNews[i] ?? [],
      marketSnapshot: marketCtx.snapshotBlock,
      marketCloseFraming,
      // 只有每日 brief 路徑有 market context，故只有它能掛 series evidenceRef。
      // 兩條 single-news 路徑不傳，claim 就只會有 citation ref——那是既有的資料條件，不是遺漏。
      citableSeries: marketCtx.citableSeries,
      seriesAnchors: marketCtx.seriesAnchors,
      onCallRecord: onCall,
    })
    return attachTier2Chains({
      tier1Output,
      news: { title: news.title, text: news.text, id: news.id },
      reportDate: p.date,
      marketSnapshot: marketCtx.snapshotBlock,
      onCallRecord: onCall,
    })
  })
  const analystOutputs: AnalystOutput[] = []
  analystResults.forEach((res, i) => {
    const newsId = survivedNews[i]?.news.id ?? ''
    if (res.status === 'fulfilled')
      // newsId 強制對齊已知 selected news id（LLM 可能回不同 id）、保證 relatedNews by-id resolve 對得上 selectedNewsById
      analystOutputs.push({ ...res.value, newsId })
    else
      partialFailed.push({ newsId, error: String((res.reason as Error)?.message ?? res.reason) })
  })
  assertLlmCallBudget(p.metadata.llmCalls.length)

  if (analystOutputs.length < MIN_NEWS_FOR_BRIEF)
    throw new Error(`runDailyBrief: insufficient analyst outputs (${analystOutputs.length} < ${MIN_NEWS_FOR_BRIEF})`)

  // Stage 4: Synthesizer（prose only）
  const synth = await callSynthesizer({
    analystOutputs,
    date: p.date,
    marketSnapshot: marketCtx.snapshotBlock,
    marketCloseFraming,
    ...(p.continuityHint !== undefined ? { continuityHint: p.continuityHint } : {}),
    onCallRecord: onCall,
  })

  const mergedCascadeChains = analystOutputs.flatMap(a => a.cascadeChains)

  // claim ledger。**合併去重是純函式、不是 LLM 工作**——這兩件事完全機械可判。
  // synthesizer 是 ledger owner，指的是責任歸屬（掛在這一段產出），
  // 不是叫它的 LLM 去合併，所以這裡緊接著 Stage 4 而不是進 synthesizer 的 prompt。
  // narrative 目前只拿它當 claimIds 白名單、之後才會真的進 prompt。
  const claimLedger = buildClaimLedger(analystOutputs.map(a => a.claims))

  // 組裝 gate：citations 由 analyst 源頭組裝、relatedNews by-id resolve、cascade filter、真 url
  const selectedNewsById = new Map(
    survivedNews.map(s => [s.news.id, { title: s.news.title, url: s.news.url }] as const),
  )
  const brief = assembleDailyBrief({
    synth,
    analystOutputs,
    selectedNewsById,
    cascadeChains: mergedCascadeChains,
    ...(p.dailyThesis !== undefined ? { dailyThesis: p.dailyThesis } : {}),
  })
  const safeDailyThesis = brief.dailyThesis
  assertLlmCallBudget(p.metadata.llmCalls.length)

  // Stage 4.5 (Viewpoints) ‖ Stage 5 (NarrativeWriter)：兩者互相獨立、平行執行省延遲。
  // viewpoints 不餵 narrative（narrative 輸入不變、保住可讀/深度不回退）；無 dailyThesis
  // （editor fallback）則跳過辯論、辯論失敗/違規內部 degrade null，皆不阻擋 brief。
  // narrative throw 才會讓整條 reject（與序列時行為一致）；onCall 為同步 push、並發安全。
  // chain-grouper 掛進同一批：只吃 chains 與力場名、與另外兩者無關，藏在 narrative 的延遲裡
  const [viewpoints, narrativeResult, groupedChains] = await Promise.all([
    safeDailyThesis
      ? runViewpointsDebate({
          thesis: safeDailyThesis,
          headline: brief.headline,
          summary: brief.summary,
          marketSnapshot: marketCtx.snapshotBlock,
          cascadeChains: mergedCascadeChains,
          claimLedger: claimLedger.claims,
          onCallRecord: onCall,
        })
      : Promise.resolve(null),
    callNarrativeWriter({
      brief,
      analystOutputs,
      news: survivedNews.map(s => s.news),
      citations: brief.citations,
      calendarBlock: marketCtx.calendarBlock,
      officialBlock: marketCtx.officialBlock,
      storylineBlock: p.storylineBlock ?? null,
      briefDate: p.date,
      marketCloseFraming,
      marketSnapshot: marketCtx.snapshotBlock,
      // ledger 先只當 claimIds 的白名單（strip 未知 id）；進 prompt 是之後的事
      claimLedger: claimLedger.claims,
      ...(p.mainThemes ? { mainThemes: p.mainThemes } : {}),
      ...(safeDailyThesis ? { dailyThesis: safeDailyThesis } : {}),
      ...(p.reportKind !== undefined ? { reportKind: p.reportKind } : {}),
      ...(p.weeklyRecapBlock !== undefined ? { weeklyRecapBlock: p.weeklyRecapBlock } : {}),
      onCallRecord: onCall,
    }),
    tagChainForceGroups({ chains: brief.cascadeChains ?? [], forceNames: brief.affectedIndustries.map(i => i.name), onCallRecord: onCall }),
  ])

  // Stage 6：newsTitlesById
  const newsTitlesById: Record<string, string> = Object.fromEntries(
    survivedNews.map(s => [s.news.id, s.news.title]),
  )

  if (partialFailed.length > 0) {
    p.metadata.partialSuccess = {
      failedNewsIds: partialFailed.map(f => f.newsId),
      failedReasons: partialFailed,
    }
  }
  return {
    ...brief,
    cascadeChains: groupedChains,
    narrative: narrativeResult.narrative ?? null,
    viewpoints,
    newsTitlesById,
    dataFreshness: marketCtx.dataFreshness,
    calendarEvents: marketCtx.calendarEvents,
    calendarCoverage: marketCtx.calendarCoverage,
    claimLedger: claimLedger.claims,
  }
}

export interface RunSingleNewsParams {
  input: { title: string, text: string, id?: string }
  metadata: RunMetadata
  /** 報告日（台北曆日）。必填，同 RunAnalystOnlyParams。 */
  briefDate: string
}

export interface RunSingleNewsResult {
  analyst: AnalystOutput
  retrievedUrls: string[]
}

export async function runSingleNews(p: RunSingleNewsParams): Promise<RunSingleNewsResult> {
  const onCall = (r: LlmCallRecord) => {
    p.metadata.llmCalls.push(r)
    p.metadata.totalCostUsd += r.costUsd
    p.metadata.totalLatencyMs += r.latencyMs
  }

  const decomposed = await callDecomposer({
    newsTitle: p.input.title,
    newsText: p.input.text,
    ...(p.input.id !== undefined ? { newsId: p.input.id } : {}),
    onCallRecord: onCall,
  })

  const retrieved = await retrieveForDecomposed(decomposed, p.briefDate)

  const tier1Output = await callAnalystTier1({
    newsTitle: p.input.title,
    newsText: p.input.text,
    ...(p.input.id !== undefined ? { newsId: p.input.id } : {}),
    decomposed,
    retrieved,
    briefDate: p.briefDate,
    onCallRecord: onCall,
  })

  const analyst = await attachTier2Chains({
    tier1Output,
    news: { title: p.input.title, text: p.input.text, ...(p.input.id !== undefined ? { id: p.input.id } : {}) },
    reportDate: p.briefDate,
    onCallRecord: onCall,
  })
  return { analyst, retrievedUrls: retrieved.map(r => r.url) }
}
