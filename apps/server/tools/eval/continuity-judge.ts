import type { MarketBrief } from '@suanomics/shared'
import type { LlmCallRecord } from '../../src/agents/llm-wrapper.js'
import type { DimCompareResult } from './pairwise.js'
import { z } from 'zod'
import { callAgentLLM } from '../../src/agents/llm-wrapper.js'
import { buildContinuityUserContent } from './continuity-input.js'
import { CONTINUITY_COMPARE_SYSTEM_PROMPT } from './continuity-judge.prompt.js'
import { aggregateDim, mapWinner } from './pairwise.js'

// 連續性 pairwise 量尺：單次 judge call（一個 orientation）對三維度各判 甲/乙/相當 + 理由。
const Winner = z.enum(['甲', '乙', '相當'])
const Dim = z.object({ winner: Winner, reason: z.string() })

export const ContinuityCompareSchema = z.object({
  crossDay: Dim,
  thesisDelta: Dim,
  resolvePayoff: Dim,
})
export type ContinuityCompareOutput = z.infer<typeof ContinuityCompareSchema>

// Gemini RESPONSE_SCHEMA（Gemini 不認 Zod、手寫對應）
const winnerEnum = { type: 'string', enum: ['甲', '乙', '相當'] }
const dimSchema = { type: 'object', properties: { winner: winnerEnum, reason: { type: 'string' } }, required: ['winner', 'reason'] }
export const CONTINUITY_COMPARE_GEMINI_SCHEMA = {
  type: 'object',
  properties: { crossDay: dimSchema, thesisDelta: dimSchema, resolvePayoff: dimSchema },
  required: ['crossDay', 'thesisDelta', 'resolvePayoff'],
}

export interface ContinuityCompareResult {
  crossDay: DimCompareResult
  thesisDelta: DimCompareResult
  resolvePayoff: DimCompareResult
}

export interface RunContinuityCompareParams {
  todayA: MarketBrief
  todayB: MarketBrief
  yesterday: MarketBrief
  onCallRecord?: (r: LlmCallRecord) => void
}

// 單次 judge 呼叫（一個 orientation）：first/second 為今日兩版、yesterday 為共用基準線。
async function judgeOnce(
  first: MarketBrief,
  second: MarketBrief,
  yesterday: MarketBrief,
  onCallRecord?: (r: LlmCallRecord) => void,
): Promise<ContinuityCompareOutput> {
  const raw = await callAgentLLM<unknown>({
    agentName: 'brief-continuity-judge',
    systemPrompt: CONTINUITY_COMPARE_SYSTEM_PROMPT,
    userContent: buildContinuityUserContent(first, second, yesterday),
    responseSchema: CONTINUITY_COMPARE_GEMINI_SCHEMA,
    ...(onCallRecord !== undefined ? { onCallRecord } : {}),
  })
  return ContinuityCompareSchema.parse(raw)
}

// position-bias-control 核心：orientation 1（A=甲、B=乙）、orientation 2（B=甲、A=乙）；
// 每維度套 mapWinner + aggregateDim：兩次同向判才算勝、矛盾 / 含 tie 一律 tie。昨日基準線兩 orientation 相同。
export async function runContinuityCompare(p: RunContinuityCompareParams): Promise<ContinuityCompareResult> {
  const o1 = await judgeOnce(p.todayA, p.todayB, p.yesterday, p.onCallRecord)
  const o2 = await judgeOnce(p.todayB, p.todayA, p.yesterday, p.onCallRecord)
  const dim = (key: keyof ContinuityCompareOutput): DimCompareResult => ({
    winner: aggregateDim(mapWinner(o1[key].winner, true), mapWinner(o2[key].winner, false)),
    reasons: [o1[key].reason, o2[key].reason],
  })
  return { crossDay: dim('crossDay'), thesisDelta: dim('thesisDelta'), resolvePayoff: dim('resolvePayoff') }
}
