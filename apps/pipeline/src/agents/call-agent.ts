import type { z } from 'zod'
import type { DailyCostGate, LlmCallStatus } from './cost-gate.js'
import type { AgentName, LlmProvider } from './models.js'
import type { RetryReason } from './narrative-shared.js'
import type { TokenUsage } from './pricing.js'
import { setTimeout as delay } from 'node:timers/promises'
import { anthropic } from '@ai-sdk/anthropic'
import { APICallError, generateText, NoObjectGeneratedError, Output } from 'ai'
import { getDailyCostGate } from './cost-gate.js'
import { toLlmAccountError } from './llm-account-error.js'
import { resolveAgentModel } from './models.js'
import { computeCost, PRICE_VERSION, priceFor } from './pricing.js'

/** 每次 LLM 呼叫的紀錄；只有某一個 agent 會填的欄位標在註解裡。 */
export interface LlmCallRecord {
  agentName: AgentName
  newsId?: string
  provider?: LlmProvider
  model?: string
  tokensIn: number
  tokensOut: number
  cachedReadTokens?: number
  cacheWriteTokens?: number
  costUsd: number
  latencyMs: number
  attempts: number
  // analyst 專用：graceful-degrade strip 路徑剝掉的 fabricated citation 數量
  fabricationStripped?: number
  // narrative-writer 專用（語意見 narrative-writer.ts）
  narrativeFailed?: boolean
  narrativeRetryReason?: RetryReason
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

export interface AgentInput {
  systemPrompt: string
  userContent: string
}

export interface CallAgentOptions {
  newsId?: string
  onCallRecord?: (r: LlmCallRecord) => void
  gate?: DailyCostGate
  maxAttempts?: number
  timeoutMs?: number
  retryDelayMs?: number
}

// Sonnet 5.5 與 Haiku 5.5 預設開 adaptive thinking，thinking token 也算在 max_tokens 內；
// 上限太低會截斷輸出、整筆 parse 失敗。非串流呼叫 16000 仍在 SDK 的 HTTP timeout 內。
const MAX_OUTPUT_TOKENS = 16_000
const DEFAULT_TIMEOUT_MS = 180_000
const DEFAULT_MAX_ATTEMPTS = 3
const DEFAULT_RETRY_DELAY_MS = 1_000
const MAX_RETRY_AFTER_SECONDS = 60
// API 沒回 usage（5xx、timeout 等）時金額未知，記 null 而不是 0，失敗次數才查得到。
const NO_USAGE: TokenUsage = { noCacheInputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 0 }

// SDK 內建的 retry 另含 408／409，範圍比這裡要的寬，所以關掉自己判斷。
// timeout 不是 APICallError，不會重試。
function isRetryable(error: unknown): boolean {
  if (!APICallError.isInstance(error))
    return false
  if (error.statusCode === undefined)
    return error.isRetryable
  return error.statusCode === 429 || error.statusCode >= 500
}

// 關掉 SDK 內建 retry 後要自己遵守 retry-after；不合理的值（負數、超過 60 秒）照 SDK 的做法忽略。
function retryAfterMs(error: unknown): number {
  if (!APICallError.isInstance(error))
    return 0
  const seconds = Number(error.responseHeaders?.['retry-after'])
  return Number.isFinite(seconds) && seconds >= 0 && seconds <= MAX_RETRY_AFTER_SECONDS ? seconds * 1_000 : 0
}

interface SdkUsage {
  inputTokens: number | undefined
  outputTokens: number | undefined
  inputTokenDetails?: {
    noCacheTokens: number | undefined
    cacheReadTokens: number | undefined
    cacheWriteTokens: number | undefined
  }
}

function toTokenUsage(usage: SdkUsage): TokenUsage {
  const cacheReadTokens = usage.inputTokenDetails?.cacheReadTokens ?? 0
  const cacheWriteTokens = usage.inputTokenDetails?.cacheWriteTokens ?? 0
  return {
    noCacheInputTokens: usage.inputTokenDetails?.noCacheTokens
      ?? (usage.inputTokens ?? 0) - cacheReadTokens - cacheWriteTokens,
    cacheReadTokens,
    cacheWriteTokens,
    outputTokens: usage.outputTokens ?? 0,
  }
}

export async function callAgent<T>(
  name: AgentName,
  input: AgentInput,
  schema: z.ZodType<T>,
  options: CallAgentOptions = {},
): Promise<T> {
  const agentModel = resolveAgentModel(name)
  // 沒價格的 model 要在花錢之前擋下，不是呼叫完才發現算不出成本。
  priceFor(agentModel.model)
  const gate = options.gate ?? getDailyCostGate()
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS
  const startedAt = Date.now()

  const recordLedger = (usage: TokenUsage, attempts: number, status: LlmCallStatus, costUsd: number | null): Promise<void> => gate.recordCall({
    agent: name,
    provider: agentModel.provider,
    model: agentModel.model,
    priceVersion: PRICE_VERSION,
    ...(options.newsId !== undefined ? { newsId: options.newsId } : {}),
    tokensIn: usage.noCacheInputTokens,
    tokensOut: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    latencyMs: Date.now() - startedAt,
    attempts,
    status,
    costUsd,
  })

  const report = async (sdkUsage: SdkUsage, attempts: number, status: LlmCallStatus): Promise<void> => {
    const usage = toTokenUsage(sdkUsage)
    const costUsd = computeCost(agentModel.model, usage)
    await recordLedger(usage, attempts, status, costUsd)
    options.onCallRecord?.({
      agentName: name,
      ...(options.newsId !== undefined ? { newsId: options.newsId } : {}),
      provider: agentModel.provider,
      model: agentModel.model,
      tokensIn: usage.noCacheInputTokens + usage.cacheReadTokens + usage.cacheWriteTokens,
      tokensOut: usage.outputTokens,
      cachedReadTokens: usage.cacheReadTokens,
      cacheWriteTokens: usage.cacheWriteTokens,
      costUsd,
      latencyMs: Date.now() - startedAt,
      attempts,
    })
  }

  const invoke = () => generateText({
    model: anthropic(agentModel.model),
    system: {
      role: 'system',
      content: input.systemPrompt,
      providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
    },
    prompt: input.userContent,
    output: Output.object({ schema }),
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    maxRetries: 0,
    timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  })

  for (let attempt = 1; ; attempt++) {
    gate.assertWithinLimit()
    let result: Awaited<ReturnType<typeof invoke>>
    try {
      result = await invoke()
    }
    catch (error) {
      const accountError = toLlmAccountError(error)
      const willRetry = accountError === null && attempt < maxAttempts && isRetryable(error)
      // 輸出不符 schema 時 token 已經計費，沒記到就會讓花費閘少算。
      if (NoObjectGeneratedError.isInstance(error) && error.usage)
        await report(error.usage, attempt, 'invalid_output')
      else if (!willRetry)
        await recordLedger(NO_USAGE, attempt, 'failed', null)
      if (!willRetry)
        throw accountError ?? error
      await delay(Math.max(retryDelayMs * 2 ** (attempt - 1), retryAfterMs(error)))
      continue
    }
    // 記帳放在 try 外：記帳失敗不能被當成 API 錯誤重打。
    await report(result.usage, attempt, 'ok')
    return result.output
  }
}
