import type { MarketBrief } from '@suanomics/shared'
import type { AnalystOutput, DecomposerOutput, NewsItem } from '../agents/types.js'
import type { MarketContext } from '../ingest/market-data/context.js'
import type { DailyProgress, RunStage } from './daily.js'
import type { BriefNews, EditorStageResult } from './editor-stage.js'
import { buildClaimLedger } from '@suanomics/shared'
import { callAnalystTier1 } from '../agents/analyst.js'
import { tagChainForceGroups } from '../agents/chain-grouper.js'
import { callDecomposer } from '../agents/decomposer.js'
import { buildMarketCloseFraming } from '../agents/market-close-framing.js'
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

async function decomposeNews(news: NewsItem[]): Promise<Decomposed[]> {
  const settled = await fanoutSettled(news, FANOUT.decomposer, n => callDecomposer({ newsTitle: n.title, newsText: n.text, newsId: n.id }))
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
    const tier2Chains = await runTier2Fanout({ news: { title: news.title, text: news.text, id: news.id }, tier1Chains, reportDate: date, marketSnapshot: market.snapshotBlock })
    return { ...tier1, cascadeChains: [...tier1Chains, ...tier2Chains] }
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
  return outputs
}

export async function generateBrief(p: GenerateBriefParams): Promise<MarketBrief> {
  const { date, market, editor, stage, progress } = p
  const marketCloseFraming = buildMarketCloseFraming(market.taiexCloseDate, date)
  const news: NewsItem[] = p.news.map(n => ({ ...n, id: String(n.id) }))

  const survived = await stage('decompose', () => decomposeNews(news))
  const retrieved = await stage('retrieve', async () => {
    const settled = await fanoutSettled(survived, FANOUT.retrieve, s => retrieveForDecomposed(s.decomposed, date))
    return settled.map(r => (r.status === 'fulfilled' ? r.value : []))
  })
  const analystOutputs = await stage('analyst', () => analyzeNews(survived, retrieved, date, market, marketCloseFraming))
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

  const [viewpoints, narrative, groupedChains] = await stage('finalize', () => Promise.all([
    thesis
      ? runViewpointsDebate({ thesis, headline: assembled.headline, summary: assembled.summary, marketSnapshot: market.snapshotBlock, cascadeChains: mergedChains, claimLedger: claimLedger.claims })
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
      marketCloseFraming,
      marketSnapshot: market.snapshotBlock,
      claimLedger: claimLedger.claims,
      ...(editor.selection?.mainThemes ? { mainThemes: editor.selection.mainThemes } : {}),
      ...(thesis ? { dailyThesis: thesis } : {}),
    }),
    tagChainForceGroups({ chains: assembled.cascadeChains ?? [], forceNames: assembled.affectedIndustries.map(i => i.name) }),
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
