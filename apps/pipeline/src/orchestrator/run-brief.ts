import type { MarketBrief } from '@suanomics/shared'
import type { AnalystOutput, DecomposerOutput, NewsItem } from '../agents/types.js'
import type { MarketContext } from '../ingest/market-data/context.js'
import type { DailyProgress, RunStage } from './daily.js'
import type { BriefNews, EditorStageResult } from './editor-stage.js'
import { buildClaimLedger } from '@suanomics/shared'
import { callAnalystTier1 } from '../agents/analyst.js'
import { tagChainForceGroups } from '../agents/chain-grouper.js'
import { renumberChainsAcrossNews } from '../agents/chain-ids.js'
import { DailyCostLimitExceededError, LlmAccountError } from '../agents/cost-gate.js'
import { callDecomposer } from '../agents/decomposer.js'
import { buildMarketCloseFraming } from '../agents/market-close-framing.js'
import { buildMarketClosureBlock } from '../agents/market-closure.js'
import { callNarrativeWriter } from '../agents/narrative-writer.js'
import { retrieveForDecomposed } from '../agents/retrieve-for-decomposed.js'
import { callSynthesizer } from '../agents/synthesizer.js'
import { runTier2Fanout, stampTier1 } from '../agents/tier2-fanout.js'
import { runViewpointsDebate } from '../agents/viewpoints-debate.js'
import { assembleDailyBrief } from '../brief/assemble.js'
import { FANOUT, fanoutSettled } from './fanout.js'

const MIN_NEWS_FOR_BRIEF = 2

export interface GenerateBriefParams {
  date: string
  news: BriefNews[]
  market: MarketContext
  editor: EditorStageResult
  stage: RunStage
  progress: DailyProgress
}

interface Decomposed { news: NewsItem, decomposed: DecomposerOutput }

function reasonText(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

// 逐則累積，花費閘中途觸發時已付費的結果才不會隨整階段失敗遺失。同則重寫時取代舊值。
function recordAnalyst(progress: DailyProgress, output: AnalystOutput): void {
  progress.analystOutputs = [...(progress.analystOutputs ?? []).filter(a => a.newsId !== output.newsId), output]
}

async function decomposeNews(news: NewsItem[], progress: DailyProgress): Promise<Decomposed[]> {
  const settled = await fanoutSettled(news, FANOUT.decomposer, async (n) => {
    const decomposed = await callDecomposer({ newsTitle: n.title, newsText: n.text, newsId: n.id })
    progress.decomposed = [...(progress.decomposed ?? []), { newsId: n.id, decomposed }]
    return decomposed
  })
  const survived: Decomposed[] = []
  settled.forEach((res, i) => {
    const item = news[i]
    if (item && res.status === 'fulfilled')
      survived.push({ news: item, decomposed: res.value })
    else if (res.status === 'rejected')
      console.warn(`[brief] decomposer 失敗 news=${item?.id}：${reasonText(res.reason)}`)
  })
  if (survived.length < MIN_NEWS_FOR_BRIEF)
    throw new Error(`decomposer 存活新聞不足（${survived.length} < ${MIN_NEWS_FOR_BRIEF}）`)
  return survived
}

async function analyzeNews(
  items: Decomposed[],
  retrieved: Awaited<ReturnType<typeof retrieveForDecomposed>>[],
  date: string,
  market: MarketContext,
  marketCloseFraming: string | null,
  progress: DailyProgress,
): Promise<AnalystOutput[]> {
  const settled = await fanoutSettled(items, FANOUT.tier1, async ({ news, decomposed }, i) => {
    const tier1 = await callAnalystTier1({
      newsTitle: news.title,
      newsText: news.text,
      newsId: news.id,
      newsUrl: news.url,
      publishedAt: news.publishedAt,
      briefDate: date,
      decomposed,
      retrieved: retrieved[i] ?? [],
      marketSnapshot: market.snapshotBlock,
      marketCloseFraming,
      citableSeries: market.citableSeries,
      seriesAnchors: market.seriesAnchors,
    })
    const tier1Chains = stampTier1(tier1.cascadeChains)
    recordAnalyst(progress, { ...tier1, cascadeChains: tier1Chains, newsId: news.id })
    const tier2Chains = await runTier2Fanout({ news: { title: news.title, text: news.text, id: news.id }, tier1Chains, reportDate: date, marketSnapshot: market.snapshotBlock })
    const output = { ...tier1, cascadeChains: [...tier1Chains, ...tier2Chains] }
    recordAnalyst(progress, { ...output, newsId: news.id })
    return output
  })
  const outputs: AnalystOutput[] = []
  settled.forEach((res, i) => {
    const newsId = items[i]?.news.id ?? ''
    if (res.status === 'fulfilled')
      // LLM 可能回不同 id，強制對齊才能讓 relatedNews 依 id 解析得到。
      outputs.push({ ...res.value, newsId })
    else
      console.warn(`[brief] analyst 失敗 news=${newsId}：${reasonText(res.reason)}`)
  })
  if (outputs.length < MIN_NEWS_FOR_BRIEF)
    throw new Error(`analyst 產出不足（${outputs.length} < ${MIN_NEWS_FOR_BRIEF}）`)
  return renumberChainsAcrossNews(outputs)
}

// 不用 Promise.all：它在第一個 reject 就返回，其餘 LLM 呼叫會在 run 收尾後繼續計費且不進統計。
async function settleFinalize<A, B, C>(calls: [Promise<A>, Promise<B>, Promise<C>]): Promise<[A, B, C]> {
  const results = await Promise.allSettled(calls)
  const rejected = results.filter(r => r.status === 'rejected').map(r => r.reason as unknown)
  const firstError = rejected.find(e => e instanceof LlmAccountError) ?? rejected.find(e => e instanceof DailyCostLimitExceededError) ?? rejected[0]
  if (rejected.length > 0)
    throw firstError
  return Promise.all(calls)
}

export async function generateBrief(p: GenerateBriefParams): Promise<MarketBrief> {
  const { date, market, editor, stage, progress } = p
  const marketCloseFraming = buildMarketCloseFraming(market.taiexCloseDate, date)
  const news: NewsItem[] = p.news.map(n => ({ ...n, id: String(n.id) }))

  const survived = await stage('decompose', () => decomposeNews(news, progress))
  const retrieved = await stage('retrieve', async () => {
    const settled = await fanoutSettled(survived, FANOUT.retrieve, s => retrieveForDecomposed(s.decomposed, date))
    return settled.map(r => (r.status === 'fulfilled' ? r.value : []))
  })
  const analystOutputs = await stage('analyst', () => analyzeNews(survived, retrieved, date, market, marketCloseFraming, progress))
  progress.analystOutputs = analystOutputs

  const synth = await stage('synthesize', () => callSynthesizer({
    analystOutputs,
    date,
    marketSnapshot: market.snapshotBlock,
    marketCloseFraming,
    continuityHint: editor.continuityHint,
  }))

  const mergedChains = analystOutputs.flatMap(a => a.cascadeChains)
  const claimLedger = buildClaimLedger(analystOutputs.map(a => a.claims))
  const assembled = assembleDailyBrief({
    synth,
    analystOutputs,
    selectedNewsById: new Map(survived.map(s => [s.news.id, { title: s.news.title, url: s.news.url }] as const)),
    cascadeChains: mergedChains,
    ...(editor.selection?.dailyThesis ? { dailyThesis: editor.selection.dailyThesis } : {}),
  })
  progress.brief = assembled
  const thesis = assembled.dailyThesis

  const finalized: NonNullable<DailyProgress['finalize']> = {}
  progress.finalize = finalized
  const [viewpoints, narrative, groupedChains] = await stage('finalize', () => settleFinalize([
    thesis
      ? runViewpointsDebate({ thesis, headline: assembled.headline, summary: assembled.summary, marketSnapshot: market.snapshotBlock, cascadeChains: mergedChains, claimLedger: claimLedger.claims }).then((r) => {
          finalized.viewpoints = r
          return r
        })
      : Promise.resolve(null),
    callNarrativeWriter({
      brief: assembled,
      analystOutputs,
      news: survived.map(s => s.news),
      citations: assembled.citations,
      calendarBlock: market.calendarBlock,
      officialBlock: market.officialBlock,
      storylineBlock: editor.storylineBlock,
      briefDate: date,
      closureBlock: buildMarketClosureBlock(date),
      marketCloseFraming,
      marketSnapshot: market.snapshotBlock,
      claimLedger: claimLedger.claims,
      ...(editor.selection?.mainThemes ? { mainThemes: editor.selection.mainThemes } : {}),
      ...(thesis ? { dailyThesis: thesis } : {}),
    }).then((r) => {
      finalized.narrative = r
      return r
    }),
    tagChainForceGroups({ chains: assembled.cascadeChains ?? [], forceNames: assembled.affectedIndustries.map(i => i.name) }).then((r) => {
      finalized.groupedChains = r
      return r
    }),
  ]))

  return {
    ...assembled,
    cascadeChains: groupedChains,
    narrative: narrative.narrative ?? null,
    viewpoints,
    newsTitlesById: Object.fromEntries(survived.map(s => [s.news.id, s.news.title])),
    dataFreshness: market.dataFreshness,
    calendarEvents: market.calendarEvents,
    calendarCoverage: market.calendarCoverage,
    claimLedger: claimLedger.claims,
  }
}
