import type { MarketBrief } from '@suanomics/shared'
import type { LlmCallRecord } from '../../src/agents/llm-wrapper.js'
import type { DimCompareResult } from './pairwise.js'
import type { QualitySourceArticle } from './quality-input.js'
import { z } from 'zod'
import { callAgentLLM } from '../../src/agents/llm-wrapper.js'
import { aggregateDim, mapWinner } from './pairwise.js'
import { buildCompareUserContent } from './quality-input.js'
import { QUALITY_COMPARE_SYSTEM_PROMPT } from './quality-judge.prompt.js'

// brief 內在品質 pairwise 量尺：單次 judge call（一個 orientation）對三維度各判 甲/乙/相當 + 理由。
const Winner = z.enum(['甲', '乙', '相當'])
const Dim = z.object({ winner: Winner, reason: z.string() })

export const QualityCompareSchema = z.object({
  depth: Dim,
  readability: Dim,
  grounding: Dim,
})
export type QualityCompareOutput = z.infer<typeof QualityCompareSchema>

// Gemini RESPONSE_SCHEMA（Gemini 不認 Zod、手寫對應）
const winnerEnum = { type: 'string', enum: ['甲', '乙', '相當'] }
const dimSchema = { type: 'object', properties: { winner: winnerEnum, reason: { type: 'string' } }, required: ['winner', 'reason'] }
export const QUALITY_COMPARE_GEMINI_SCHEMA = {
  type: 'object',
  properties: { depth: dimSchema, readability: dimSchema, grounding: dimSchema },
  required: ['depth', 'readability', 'grounding'],
}

export interface QualityCompareResult {
  depth: DimCompareResult
  readability: DimCompareResult
  grounding: DimCompareResult
}

export interface RunQualityCompareParams {
  briefA: MarketBrief
  briefB: MarketBrief
  sources: QualitySourceArticle[]
  onCallRecord?: (r: LlmCallRecord) => void
}

// 單次 judge 呼叫（一個 orientation）：將 first/second 傳給 Gemini、取回 parse 後的 QualityCompareOutput。
async function judgeOnce(
  first: MarketBrief,
  second: MarketBrief,
  sources: QualitySourceArticle[],
  onCallRecord?: (r: LlmCallRecord) => void,
): Promise<QualityCompareOutput> {
  const raw = await callAgentLLM<unknown>({
    agentName: 'brief-quality-judge',
    systemPrompt: QUALITY_COMPARE_SYSTEM_PROMPT,
    userContent: buildCompareUserContent(first, second, sources),
    responseSchema: QUALITY_COMPARE_GEMINI_SCHEMA,
    ...(onCallRecord !== undefined ? { onCallRecord } : {}),
  })
  return QualityCompareSchema.parse(raw)
}

// runQualityCompare：position-bias-control 核心。
// orientation 1：A=甲、B=乙（firstIsA=true）；orientation 2：B=甲、A=乙（firstIsA=false）。
// 每維度套 mapWinner + aggregateDim：兩次同向判才算勝、矛盾 / 含 tie 一律 tie。
export async function runQualityCompare(p: RunQualityCompareParams): Promise<QualityCompareResult> {
  const o1 = await judgeOnce(p.briefA, p.briefB, p.sources, p.onCallRecord)
  const o2 = await judgeOnce(p.briefB, p.briefA, p.sources, p.onCallRecord)
  const dim = (key: 'depth' | 'readability' | 'grounding'): DimCompareResult => ({
    winner: aggregateDim(mapWinner(o1[key].winner, true), mapWinner(o2[key].winner, false)),
    reasons: [o1[key].reason, o2[key].reason],
  })
  return { depth: dim('depth'), readability: dim('readability'), grounding: dim('grounding') }
}
