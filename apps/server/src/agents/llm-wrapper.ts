import type { AgentName, LlmProvider } from './providers/resolve.js'
import { warnLlmConcurrencyBudgetOnce } from './fanout-concurrency.js'
import { callAnthropic } from './providers/anthropic.js'
import { callGemini } from './providers/gemini.js'
import { callOpenAI } from './providers/openai.js'
import { computeCost } from './providers/pricing.js'
import { resolveAgentModel } from './providers/resolve.js'

/**
 * 每次 provider 呼叫的紀錄。
 *
 * 下面那些「只有某一個 agent 會填」的欄位不是死碼，別因為 TypeScript 裡找不到讀取端就收窄：
 * `onCallRecord` 收到的 record 由 orchestrator／brief-worker 原樣推進 `RunMetadata.llmCalls`，
 * 再由 handler 回傳的 `JobOutcome.metadata` 整包寫進 `background_jobs.metadata`（jsonb）。註解裡講的
 * 「prod 觀測」指的是查那張表，消費端是 SQL 不是程式碼。
 */
export interface LlmCallRecord {
  agentName: AgentName
  newsId?: string
  tokensIn: number
  tokensOut: number
  costUsd: number
  latencyMs: number
  attempts: number
  // 哪個 provider 跑這次呼叫（optional、既有 caller 不破）；prod 觀測 provider 分流比例
  provider?: LlmProvider
  // prompt caching 觀測：cache 命中 / 寫入 token（無 caching 時不帶）
  cachedReadTokens?: number
  cacheWriteTokens?: number
  // analyst 專用：當 callAnalystTier1 / callAnalystTier2 進入 graceful-degrade strip 路徑、會在最後一筆 record 標記
  // 被剝掉的 fabricated citation 數量、供 prod 觀測「analyst graceful degrade 觸發比例」
  fabricationStripped?: number
  // narrative-writer 專用：
  // - narrativeFailed=true 時 narrative=null、prod 看 fail rate trends
  // - narrativeRetryReason 記第一次 attempt 失敗原因
  // - narrativeFabricationStripped 記 sanitize 命中替換次數
  // - narrativeClaimIdsStripped 記被 strip 的未知 claimId 數（prod 看模型掛錯 claim 的比例）
  // - narrativeClaimCitationUrlsDropped 記 claim 的 citation ref 對不上 brief.citations 的個數
  // - narrativeClaimCitationSections 記 citationUrls 由 claim 反推決定的 section 數
  // - narrativeClaimUnboundNumbers / narrativeClaimCheckedNumbers 記「數字對不回本段掛的 claim」
  //   的個數與分母。這是軟警告、不擋 pipeline：非 0 要進 log 查明細。**與 traceability ①
  //   不是同一個判準**——①對整個 ledger 池比對，能對回池子不代表用對了段落。
  narrativeFailed?: boolean
  narrativeRetryReason?: 'zod-parse' | 'gemini-api' | 'timeout' | 'compliance-residual' | null
  narrativeFabricationStripped?: number
  narrativeClaimIdsStripped?: number
  narrativeClaimCitationUrlsDropped?: number
  narrativeClaimCitationSections?: number
  narrativeClaimUnboundNumbers?: number
  narrativeClaimCheckedNumbers?: number
  // - narrativeClaimIdsTruncated 記因 max 8 上限被截掉的 claimId 數。判讀 unbound 的必要
  //   脈絡：非 0 時 unbound 可能是「模型宣稱了但掛不上」而非「模型亂用數字」。
  narrativeClaimIdsTruncated?: number
  // podcast-writer 專用：
  // - podcastFailed=true 時 podcast=null、prod 看 fail rate trends
  // - podcastRetryReason 記第一次 attempt 失敗原因
  // - podcastForbiddenSanitized 記 sanitize 命中替換次數
  podcastFailed?: boolean
  podcastRetryReason?: 'zod-parse' | 'gemini-api' | 'timeout' | 'compliance-residual' | null
  podcastForbiddenSanitized?: number
  // synthesizer 專用：terminal sanitize fallback 命中替換次數（>0 代表 retry 耗盡走了 sanitize）
  synthForbiddenSanitized?: number
}

export interface CallAgentLLMParams {
  agentName: AgentName
  systemPrompt: string
  userContent: string
  responseSchema: unknown
  newsId?: string
  timeoutMs?: number
  maxRetries?: number
  retryDelayMs?: number
  onCallRecord?: (r: LlmCallRecord) => void
}

// Per-agent timeout defaults。Analyst 有長 corpus 需要 90s headroom、
// decomposer / synthesizer 的 prompt 較短、給較緊的 budget。
// 保守設定：寧可等完不要誤殺（P3 評估顯示 60s 不夠 analyst）
const AGENT_TIMEOUT_MS: Record<AgentName, number> = {
  'decomposer': 30_000,
  'analyst-tier1': 90_000,
  'analyst-tier2': 90_000,
  'synthesizer': 60_000,
  'editor': 45_000,
  'narrative-writer': 120_000, // 3.1-pro ~58s、留緩衝
  'podcast-writer': 90_000,
  'brief-judge': 120_000, // eval judge、逐字稿長
  'brief-quality-judge': 120_000,
  'brief-continuity-judge': 120_000,
  'news-categorizer': 30_000,
  'news-tagger': 30_000,
  'viewpoints-debate': 60_000,
  // 純分類、輸入只有幾十個短字串；spike 實測 14.7s
  'chain-grouper': 30_000,
  // 單篇 corpus 文章摘要 + 抽實體。輸入是正文 slice(0, 8000)、比 categorizer / tagger 的
  // 標題 + excerpt 大得多，所以留 45s 餘裕而不是比照那兩個的 30s。AbortError 在本檔是直接
  // throw 不重試，但 entity-summary 的外層迴圈會接住並重算一次預算（見該檔「重試分工」）。
  'corpus-entity-summary': 45_000,
}

// Anthropic 路徑專用：Claude 需明確 max_tokens（Gemini 走 responseSchema 不需要）。
// 長文 agent（podcast / narrative）給 8192、其餘預設 4096。
const AGENT_MAX_TOKENS: Record<AgentName, number> = {
  'decomposer': 4096,
  'analyst-tier1': 4096,
  'analyst-tier2': 4096,
  'synthesizer': 4096,
  'editor': 4096,
  'narrative-writer': 8192,
  'podcast-writer': 8192,
  'brief-judge': 8192,
  'brief-quality-judge': 8192,
  'brief-continuity-judge': 8192,
  'news-categorizer': 2048,
  'news-tagger': 2048,
  'viewpoints-debate': 4096,
  // 輸出是 label→force 的映射、一條約 20 token；spike 實測 49 個標籤用掉 896
  'chain-grouper': 2048,
  // 輸出是短 JSON（80-120 字摘要 + entities + tags）、比照 news-categorizer / news-tagger
  'corpus-entity-summary': 2048,
}

export async function callAgentLLM<T>(p: CallAgentLLMParams): Promise<T> {
  // 所有經過這個 chokepoint 的呼叫路徑（server pipeline、CLI、批次評測腳本）
  // 都在第一次真正打 provider 之前印一次並行預算警告；once-guard 在 fanout-concurrency.ts。
  warnLlmConcurrencyBudgetOnce()
  const maxRetries = p.maxRetries ?? 3
  const retryDelayMs = p.retryDelayMs ?? 1000
  const timeoutMs = p.timeoutMs ?? AGENT_TIMEOUT_MS[p.agentName] ?? 90_000

  const startedAt = Date.now()
  let attempts = 0
  let lastErr: unknown

  while (attempts < maxRetries) {
    attempts++
    try {
      const { provider, model } = resolveAgentModel(p.agentName)
      const common = {
        systemPrompt: p.systemPrompt,
        userContent: p.userContent,
        responseSchema: p.responseSchema,
        timeoutMs,
      }
      const maxTokens = AGENT_MAX_TOKENS[p.agentName] ?? 4096
      const { raw, tokensIn, tokensOut, cachedReadTokens, cacheWriteTokens } = await (async () => {
        switch (provider) {
          case 'anthropic':
            return callAnthropic({ ...common, modelName: model, maxTokens })
          case 'openai':
            return callOpenAI({ ...common, modelName: model, maxTokens })
          default:
            return callGemini({ ...common, modelName: model })
        }
      })()

      // exactOptionalPropertyTypes：undefined 欄位不能直接傳、要用 spread 排除
      const costUsd = computeCost(provider, model, {
        tokensIn,
        tokensOut,
        ...(cachedReadTokens ? { cachedReadTokens } : {}),
        ...(cacheWriteTokens ? { cacheWriteTokens } : {}),
      })

      const record: LlmCallRecord = {
        agentName: p.agentName,
        ...(p.newsId !== undefined ? { newsId: p.newsId } : {}),
        tokensIn,
        tokensOut,
        costUsd,
        latencyMs: Date.now() - startedAt,
        attempts,
        provider,
        ...(cachedReadTokens ? { cachedReadTokens } : {}),
        ...(cacheWriteTokens ? { cacheWriteTokens } : {}),
      }
      p.onCallRecord?.(record)

      return raw as T
    }
    catch (err) {
      lastErr = err
      const e = err as { name?: string }
      if (e.name === 'AbortError')
        throw err // 不 retry
      if (attempts >= maxRetries)
        throw err
      await new Promise(r => setTimeout(r, retryDelayMs * attempts))
    }
  }
  throw lastErr
}
