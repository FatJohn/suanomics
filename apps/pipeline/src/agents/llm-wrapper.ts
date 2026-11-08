// LLM 呼叫層的暫時介面。#22 只搬 agents，不搬 v0 的 llm-wrapper 與 provider adapter；
// 這個檔只保留 agents 會用到的型別與函式簽名，讓搬進來的 agents 能編譯、測試能 mock。
// 真正的呼叫層（AI SDK、model 對照表、花費閘）由 #23 實作並取代本檔。

export type AgentName
  = | 'decomposer'
    | 'analyst-tier1'
    | 'analyst-tier2'
    | 'synthesizer'
    | 'editor'
    | 'narrative-writer'
    | 'news-categorizer'
    | 'news-tagger'
    | 'viewpoints-debate'
    | 'chain-grouper'

/** 每次 LLM 呼叫的紀錄；欄位沿用 v0，只有某一個 agent 會填的欄位標在註解裡。 */
export interface LlmCallRecord {
  agentName: AgentName
  newsId?: string
  tokensIn: number
  tokensOut: number
  costUsd: number
  latencyMs: number
  attempts: number
  // analyst 專用：graceful-degrade strip 路徑剝掉的 fabricated citation 數量
  fabricationStripped?: number
  // narrative-writer 專用（語意見 narrative-writer.ts）
  narrativeFailed?: boolean
  narrativeRetryReason?: 'zod-parse' | 'gemini-api' | 'timeout' | 'compliance-residual' | null
  narrativeFabricationStripped?: number
  narrativeClaimIdsStripped?: number
  narrativeClaimCitationUrlsDropped?: number
  narrativeClaimCitationSections?: number
  narrativeClaimUnboundNumbers?: number
  narrativeClaimCheckedNumbers?: number
  narrativeClaimIdsTruncated?: number
  // synthesizer 專用：terminal sanitize fallback 命中替換次數
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

export async function callAgentLLM<T>(p: CallAgentLLMParams): Promise<T> {
  throw new Error(`LLM 呼叫層尚未接上（#23），agent=${p.agentName}`)
}
