import type { JobPayloadByKind } from '@suanomics/jobs'
import type { MarketBrief } from '@suanomics/shared'
import type { CascadeChain, RetrievedArticle } from '../../agents/types.js'
import type { BriefSafetyStats } from '../../brief/analyzer.js'
import type { AnalyzeInput } from '../../brief/cache-key.js'
import type { RoutingDecision, RoutingMode } from '../../brief/routing.js'
import { saveAnalysis } from '@suanomics/db/repos/news-repo'
import { JOB_RESULT_CACHE_AGE_MS } from '@suanomics/jobs'
import { callAnalystTier1 } from '../../agents/analyst.js'
import {
  expandEntities,
  extractCanonicalEntitiesFromAnalyst,
  getDefaultAliasMap,
} from '../../agents/entity-aliases.js'
import { runAnalystOnly, runSingleNews } from '../../agents/orchestrator.js'
import { resolveAgentModel } from '../../agents/providers/resolve.js'
import { retrieveArticles } from '../../agents/retriever.js'
import { adaptAnalystToMarketBrief, finalizeAnalystToMarketBrief, finalizeBriefSafety, hashPrompt, makeInsufficientCitation } from '../../brief/analyzer.js'
import { computeInputHash, computeInputUrl } from '../../brief/cache-key.js'
import { decideRouting, synthesizeDecomposedFromHeuristic } from '../../brief/routing.js'

type Stage = 'routing' | 'retrieving' | 'analyzing' | 'saving'

/**
 * runner 交給 handler 的中段能力，窄化成 analyze 真正用到的兩支。
 * 之前這裡吃的是佇列函式庫的 job 物件——八個 kind 裡唯一直接依賴它的一個。
 */
export interface AnalyzeCtx {
  updateProgress?: (percent: number, stage?: string) => Promise<void>
  markMetadata?: (partial: Record<string, unknown>) => Promise<void>
}

export interface RunAnalyzeResult {
  analysisId: number
  routingMode: RoutingMode
  payload: MarketBrief
}

// 依 routing decision dispatch 4 mode、永遠寫 cache、回 audit 用的
// resultRef + routingMode。
export async function runAnalyze(
  payload: JobPayloadByKind['analyze'],
  ctx?: AnalyzeCtx,
): Promise<RunAnalyzeResult> {
  const input: AnalyzeInput = {
    title: payload.title,
    content: payload.content,
    ...(payload.url ? { url: payload.url } : {}),
  }
  const setProgress = async (percent: number, stage: Stage): Promise<void> => {
    await ctx?.updateProgress?.(percent, stage).catch(() => undefined)
  }

  await setProgress(10, 'routing')
  let decision = await decideRouting(input)
  await ctx?.markMetadata?.({ routingMode: decision.mode })
  await setProgress(25, 'routing')

  // 整個 job 共用一個 stats：fallback 時 dispatch 會跑第二次，兩次丟掉的數量要合計
  // （這是「這個 job 一共丟了幾條」，不是「哪一次丟的」）。
  const safetyStats: BriefSafetyStats = { droppedCitationUrls: 0 }
  let dispatched: { brief: MarketBrief, entities: string[] }
  try {
    dispatched = await dispatch(decision, input, setProgress, payload.reportDate, safetyStats)
  }
  catch (err) {
    // db-related fallback：runAnalystOnly throw → 切 full-pipeline 重跑、保 user 拿到結果。
    // cache-hit 也納入：cached payload 過不了新加的閘（多半是之前寫進去的
    // 舊格式）時，寧可重跑也不要讓整個 job 失敗。
    if (decision.mode === 'db-related' || decision.mode === 'cache-hit') {
      const from = decision.mode
      console.warn('[analyze-worker] %s fallback to full-pipeline: %s', from, (err as Error).message)
      decision = { mode: 'full-pipeline' }
      await ctx?.markMetadata?.({ routingMode: 'full-pipeline', fallbackFrom: from })
      dispatched = await dispatch(decision, input, setProgress, payload.reportDate, safetyStats)
    }
    else {
      throw err
    }
  }

  // 安全閘丟掉的爛 citation url 要留痕。丟掉本身是刻意的降級（少一條引用勝過
  // 整套 LLM 重跑），但降級若無聲，上游開始系統性吐內部 id 時沒有人會知道。
  if (safetyStats.droppedCitationUrls > 0)
    await ctx?.markMetadata?.({ droppedCitationUrls: safetyStats.droppedCitationUrls })

  await setProgress(95, 'saving')
  const inputHash = computeInputHash(input)
  const inputUrl = computeInputUrl(input)
  const expiresAt = new Date(Date.now() + JOB_RESULT_CACHE_AGE_MS)

  const analysisId = await saveAnalysis({
    newsItemId: payload.newsItemId ?? null,
    payload: dispatched.brief,
    // ★ 不要寫死型號。這一欄是 analyses 的 provenance，寫死的話換 model 之後整批列會
    // 宣稱自己是舊型號產的——而且不會有任何人發現（2026-08-23 換 3.7 時抓到）。
    // 取 analyst-tier1：它是這條路徑的主要產出者，也是 AGENT_MODELS override 生效的地方。
    model: resolveAgentModel('analyst-tier1').model,
    promptHash: hashPrompt('v2-analyze-worker', `${input.title}\n${input.content}`),
    inputHash,
    inputUrl,
    entities: dispatched.entities,
    expiresAt,
  })
  await setProgress(100, 'saving')

  return { analysisId, routingMode: decision.mode, payload: dispatched.brief }
}

// db-related mode：用 cached neighbors 的 priorChains 走 runAnalystOnly、citation 不足補 placeholder。
async function dispatchDbRelated(
  decision: Extract<RoutingDecision, { mode: 'db-related' }>,
  input: AnalyzeInput,
  setProgress: (p: number, s: Stage) => Promise<void>,
  briefDate: string,
  stats: BriefSafetyStats,
): Promise<{ brief: MarketBrief, entities: string[] }> {
  const aliasMap = getDefaultAliasMap()
  await setProgress(40, 'retrieving')
  // cached neighbors 的 affectedIndustries 是 MarketBrief shape (name / direction /
  // confidence / reasoning)、轉成 CascadeChain shape 餵 analyst priorChains。
  // direction 'mixed'/'uncertain' → 'neutral'（CascadeChain 只支援 positive/negative/neutral）
  const priorChains: CascadeChain[] = decision.cachedNeighbors
    .flatMap(n => n.payload.affectedIndustries ?? [])
    .slice(0, 8)
    .map(ind => ({
      industry: ind.name,
      mechanism: ind.reasoning,
      affectedTickers: [],
      direction: ind.direction === 'positive'
        ? 'positive' as const
        : ind.direction === 'negative'
          ? 'negative' as const
          : 'neutral' as const,
      citations: [],
    }))
  await setProgress(55, 'analyzing')
  const metadata = { llmCalls: [], totalCostUsd: 0, totalLatencyMs: 0 }
  const analyst = await runAnalystOnly({
    input: { title: input.title, text: input.content },
    inputCanonical: decision.inputCanonical,
    priorChains,
    metadata,
    briefDate,
  })
  const brief = adaptAnalystToMarketBrief(analyst)
  const entities = extractCanonicalEntitiesFromAnalyst(analyst, aliasMap)
  // citations 為空時補 placeholder（tier 1 在這條路吃 retrieved=[]，它的 citation
  // 會被 analyst-tier1 自己清光；有 citation 的話一律來自 tier 2）
  const withCitations = brief.citations.length > 0
    ? brief
    : { ...brief, citations: [makeInsufficientCitation('此分析基於 cached 類似新聞推論')] }
  // 這條路以前到上一行就 return 了，等於整個 finalizeBriefSafety 沒跑——
  // 投信投顧法禁用詞清洗、MarketBriefSchema.parse、字串 clamp 三層一起少掉，
  // 而 saveAnalysis 下游沒有第二道閘，analyst 吐什麼就寫進 DB 什麼。
  //
  // ★ 這裡刻意**不**再過一層 citation allowlist。URL 白名單屬於「誰做了檢索誰負責」
  // 那一層，而這條路的兩層 analyst 各自都已經綁死：tier 1 吃 retrieved=[]（
  // analyst-tier1.ts:94 的 allowedUrls 因此是空集合、citation 全被 strip），
  // tier 2 的 citation 綁在它自己 retrieveArticles 的結果上（analyst-tier2.ts:68）。
  // 在這裡再擋一次只會殺掉 tier 2 的合法引用——退化成每則分析都「資料不足」，
  // 而且沒有任何測試會紅。2026-08-21 差點就這樣送出去，見下方回歸測試。
  const finalBrief = finalizeBriefSafety(withCitations, stats)
  return {
    brief: finalBrief,
    entities: entities.length > 0 ? entities : decision.inputCanonical,
  }
}

// gap-scrape mode：DB alias-expand 候選 + 弱相關 cached analyses，走 callAnalystTier1。
//
// 2026-08-21 移除了這裡原本的 firecrawl gap-search。它不是壞掉不動，是**壞得看不出來**：
// v1 /search 回的欄位是 url/title/description，而 client 讀的是 r.markdown，所以
// contentSummary 永遠是空字串。金鑰壞著的那段時間它安靜地回空陣列，金鑰一修好就開始把
// 「沒有內容的 URL」送進 citation 白名單——落到讀者面的包括一則 Threads 貼文與一個支付
// 公司的名詞解釋頁，背後沒有任何被讀過的文字。
async function dispatchGapScrape(
  decision: Extract<RoutingDecision, { mode: 'gap-scrape' }>,
  input: AnalyzeInput,
  setProgress: (p: number, s: Stage) => Promise<void>,
  briefDate: string,
  stats: BriefSafetyStats,
): Promise<{ brief: MarketBrief, entities: string[] }> {
  const aliasMap = getDefaultAliasMap()
  await setProgress(35, 'retrieving')
  // firecrawl 移除後成為這條路徑的唯一素材來源：analyses cache 無
  // 60% 交集（existingDbArticles=[]）時，analyst 會拿到空 retriever、citation 全
  // placeholder。用 alias-expand 直接打 external_articles GIN 找真的被讀過的內容。
  //
  // 注意這不是保證：retrieveArticles 失敗會 catch 成 []，若 existingDbArticles 也空、
  // input.url 也沒有，allowlist 就是空集合，整份分析退化成 data:insufficient。
  // 那個退化是刻意的（寧可說「資料不足」也不要沒有依據的 citation），但別把這行讀成
  // 「一定會有東西可 cite」。
  const expanded = expandEntities(decision.inputCanonical, aliasMap)
  const dbArticles = await retrieveArticles({ entities: expanded, days: 7, limit: 10, reportDate: briefDate })
    .catch(() => [] as RetrievedArticle[])
  const merged = [...dbArticles, ...decision.existingDbArticles]
  const seen = new Set<string>()
  const dedup = merged.filter(a => seen.has(a.url) ? false : (seen.add(a.url), true))
  await setProgress(55, 'analyzing')
  const decomposed = synthesizeDecomposedFromHeuristic(decision.inputCanonical)
  const analyst = await callAnalystTier1({
    newsTitle: input.title,
    newsText: input.content,
    decomposed,
    retrieved: dedup,
    briefDate,
  })
  const allowed = new Set([...dedup.map(a => a.url), ...(input.url ? [input.url] : [])])
  const brief = finalizeAnalystToMarketBrief(analyst, [], allowed, stats)
  const entities = extractCanonicalEntitiesFromAnalyst(analyst, aliasMap)
  return {
    brief,
    entities: entities.length > 0 ? entities : decision.inputCanonical,
  }
}

// briefDate 一路從 job payload 的 reportDate 傳進來、不在這一層現算：
// 它會流進 EvidenceClaim 的 asOf，而「執行當下」與「這則分析屬於哪一天」不是同一件事。
async function dispatch(
  decision: RoutingDecision,
  input: AnalyzeInput,
  setProgress: (p: number, s: Stage) => Promise<void>,
  briefDate: string,
  stats: BriefSafetyStats,
): Promise<{ brief: MarketBrief, entities: string[] }> {
  const aliasMap = getDefaultAliasMap()
  switch (decision.mode) {
    case 'cache-hit': {
      // entities 沿用 cached、新 row 同 inputHash 24h 內等同 cache hit。
      //
      // cached payload 也要過一次閘。它是**寫進去時的**產物，而寫進去的那條路徑
      // 當時可能還沒有這道閘（之前的 db-related 就是），於是舊 row 會在 24h 的
      // cache 窗內被再供一次、再存一次，帶著沒清過的禁用詞。閘是純函式，重跑不花錢。
      return { brief: finalizeBriefSafety(decision.cached.payload, stats), entities: decision.cached.entities }
    }

    case 'db-related': {
      return dispatchDbRelated(decision, input, setProgress, briefDate, stats)
    }

    case 'gap-scrape': {
      return dispatchGapScrape(decision, input, setProgress, briefDate, stats)
    }

    case 'full-pipeline': {
      await setProgress(35, 'retrieving')
      const metadata = { llmCalls: [], totalCostUsd: 0, totalLatencyMs: 0 }
      const { analyst, retrievedUrls } = await runSingleNews({
        input: { title: input.title, text: input.content },
        metadata,
        briefDate,
      })
      const brief = finalizeAnalystToMarketBrief(
        analyst,
        retrievedUrls,
        new Set(input.url ? [input.url] : []),
        stats,
      )
      const entities = extractCanonicalEntitiesFromAnalyst(analyst, aliasMap)
      return { brief, entities }
    }
  }
}
