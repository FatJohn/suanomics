import type { LlmCallRecord } from './llm-wrapper.js'
import type { AnalystOutput } from './types.js'
import { AffectedIndustrySchema, checkCompliance, RelatedEtfSchema, RelationTypeSchema } from '@suanomics/shared'
import { z } from 'zod'
import { SYNTHESIZER_SYSTEM_PROMPT } from '../prompts/synthesizer.prompt.js'
import { SYNTHESIZER_USER_TEXT } from '../prompts/synthesizer.user-content.js'
import { truncateAtSentence, truncateString } from './_truncate.js'
import { callAgentLLM } from './llm-wrapper.js'
import { READER_SNAPSHOT_HEADING } from './market-snapshot-section.js'
import { rewriteText } from './narrative-shared.js'

// Synthesizer 解耦：只產 prose（不產 citation url、不產 relatedNews url）。
// relatedNews 改成以 newsId 引用 selected news、url 由組裝層 resolve。
export const SynthesizerRelatedNewsRefSchema = z.object({
  newsId: z.string().min(1),
  relationType: RelationTypeSchema,
  reasoning: z.string().max(600),
})
export const SynthesizerOutputSchema = z.object({
  headline: z.string().min(1).max(80),
  summary: z.string().min(1).max(300),
  relatedNews: z.array(SynthesizerRelatedNewsRefSchema).max(5),
  affectedIndustries: z.array(AffectedIndustrySchema).max(5),
  relatedETFs: z.array(RelatedEtfSchema).max(5),
  reasoningChain: z.array(z.string().max(150)).min(2).max(6),
})
export type SynthesizerOutput = z.infer<typeof SynthesizerOutputSchema>

// terminal fallback：對 synth 輸出的 prose 欄位做 field-targeted sanitize（對齊 analyzer）。
// 只動 prose、不碰 newsId / relationType / direction / confidence / ticker。
export function sanitizeSynthesizerOutput(out: SynthesizerOutput): { sanitized: SynthesizerOutput, count: number } {
  const counter = { count: 0 }
  const sanitized: SynthesizerOutput = {
    ...out,
    headline: rewriteText(out.headline, counter),
    summary: rewriteText(out.summary, counter),
    relatedNews: out.relatedNews.map(n => ({ ...n, reasoning: rewriteText(n.reasoning, counter) })),
    affectedIndustries: out.affectedIndustries.map(i => ({
      ...i,
      name: rewriteText(i.name, counter),
      reasoning: rewriteText(i.reasoning, counter),
    })),
    relatedETFs: out.relatedETFs.map(e => ({
      ...e,
      name: rewriteText(e.name, counter),
      rationale: rewriteText(e.rationale, counter),
    })),
    reasoningChain: out.reasoningChain.map(s => rewriteText(s, counter)),
  }
  return { sanitized, count: counter.count }
}

// hand-written Gemini schema：Synthesizer 解耦後只產 prose（無 citations / disclaimer）。
// relatedNews 改成 newsId 引用、url 由組裝層（assembleDailyBrief）resolve。
const RESPONSE_GEMINI_SCHEMA = {
  type: 'object',
  properties: {
    headline: { type: 'string' },
    summary: { type: 'string' },
    relatedNews: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          newsId: { type: 'string' },
          relationType: { type: 'string', enum: ['cause', 'effect', 'context', 'contrast'] },
          reasoning: { type: 'string' },
        },
        required: ['newsId', 'relationType', 'reasoning'],
      },
    },
    affectedIndustries: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          direction: { type: 'string', enum: ['positive', 'negative', 'mixed', 'uncertain'] },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          reasoning: { type: 'string' },
        },
        required: ['name', 'direction', 'confidence', 'reasoning'],
      },
    },
    relatedETFs: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          ticker: { type: 'string' },
          name: { type: 'string' },
          rationale: { type: 'string' },
        },
        required: ['ticker', 'name', 'rationale'],
      },
    },
    reasoningChain: { type: 'array', items: { type: 'string' } },
  },
  required: ['headline', 'summary', 'relatedNews', 'affectedIndustries', 'relatedETFs', 'reasoningChain'],
}

export interface CallSynthesizerParams {
  analystOutputs: AnalystOutput[]
  date: string
  marketSnapshot?: string | null
  // top-1 延續主線 hint、供標題帶跨日訊號（缺則 stateless）
  continuityHint?: string | null
  // 市場收盤時間框架 block（台股結構化錨）；orchestrator 注入、缺則略過
  marketCloseFraming?: string | null
  onCallRecord?: (r: LlmCallRecord) => void
  maxComplianceRetries?: number
}

const MAX_COMPLIANCE_RETRY_DEFAULT = 3

export async function callSynthesizer(p: CallSynthesizerParams): Promise<SynthesizerOutput> {
  const maxRetries = p.maxComplianceRetries ?? MAX_COMPLIANCE_RETRY_DEFAULT
  const baseUserContent = formatUserContent(p)

  let attempts = 0
  let feedback = ''
  let lastParsed: SynthesizerOutput | null = null

  while (attempts < maxRetries) {
    attempts++
    const userContent = feedback ? `${baseUserContent}\n\n${feedback}` : baseUserContent
    const raw = await callAgentLLM<unknown>({
      agentName: 'synthesizer',
      systemPrompt: SYNTHESIZER_SYSTEM_PROMPT,
      userContent,
      responseSchema: RESPONSE_GEMINI_SCHEMA,
      ...(p.onCallRecord !== undefined ? { onCallRecord: p.onCallRecord } : {}),
    })
    const parsed = SynthesizerOutputSchema.parse(normalizeForSynthesizerSchema(raw))
    lastParsed = parsed
    const violation = checkCompliance(JSON.stringify(parsed))
    if (!violation)
      return parsed
    // 不 echo 命中字（C1 防 echo）：只回類型 + 抽象指引、由 LLM 自行重寫。
    feedback = SYNTHESIZER_USER_TEXT.complianceRetryFeedback(violation.violation)
  }
  // retry 耗盡：sanitize best-effort、不再 throw（最終合規權威交給下游 analyzer gate）。
  // 可安全改寫的方向/軟推薦詞會被中性化；rewrite map 外的硬推薦詞由 analyzer 把關。
  if (lastParsed === null)
    throw new Error('callSynthesizer: no parseable output after retry loop (maxComplianceRetries must be >= 1)')
  const { sanitized, count } = sanitizeSynthesizerOutput(lastParsed)
  emitSynthAudit(p.onCallRecord, count)
  return sanitized
}

function emitSynthAudit(onCall: ((r: LlmCallRecord) => void) | undefined, synthForbiddenSanitized: number) {
  if (!onCall)
    return
  onCall({
    agentName: 'synthesizer',
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    latencyMs: 0,
    attempts: 0,
    synthForbiddenSanitized,
  })
}

// prod 防禦：truncate 所有 SynthesizerOutputSchema 有 max length 的字串欄位、
// slice array 到 schema max。Gemini 偶會超出 schema 約束、與其讓 z.string().max() 失敗
// throw 整個 job、不如截斷取前 N 字、保留 prose 連續性。
// reasoning / rationale 上限同步拉到 600。
// 解耦後：不再 force disclaimer 常數、也不 clamp citations（那是組裝層的職責）。
// truncate 實作在 _truncate.ts：prose 欄位（summary/reasoning/rationale）走句界截斷 truncateAtSentence、headline 仍 truncateString。
function normalizeForSynthesizerSchema(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object')
    return raw
  const r = raw as Record<string, unknown>
  const out: Record<string, unknown> = { ...r }
  if (typeof r.headline === 'string')
    out.headline = truncateString(r.headline, 80)
  if (typeof r.summary === 'string')
    out.summary = truncateAtSentence(r.summary, 300)
  if (Array.isArray(r.reasoningChain))
    out.reasoningChain = r.reasoningChain.slice(0, 6).map(s => truncateAtSentence(s, 150))
  if (Array.isArray(r.relatedNews)) {
    out.relatedNews = r.relatedNews.slice(0, 5).map((n) => {
      if (!n || typeof n !== 'object')
        return n
      const node = n as Record<string, unknown>
      return { ...node, reasoning: truncateAtSentence(node.reasoning, 600) }
    })
  }
  if (Array.isArray(r.affectedIndustries)) {
    out.affectedIndustries = r.affectedIndustries.slice(0, 5).map((n) => {
      if (!n || typeof n !== 'object')
        return n
      const node = n as Record<string, unknown>
      return { ...node, reasoning: truncateAtSentence(node.reasoning, 600) }
    })
  }
  if (Array.isArray(r.relatedETFs)) {
    out.relatedETFs = r.relatedETFs.slice(0, 5).map((n) => {
      if (!n || typeof n !== 'object')
        return n
      const node = n as Record<string, unknown>
      return { ...node, rationale: truncateAtSentence(node.rationale, 600) }
    })
  }
  return out
}

function formatUserContent(p: CallSynthesizerParams): string {
  const lines: string[] = []
  lines.push(SYNTHESIZER_USER_TEXT.dateHeading(p.date))
  lines.push('')
  lines.push(SYNTHESIZER_USER_TEXT.analystOutputsHeading(p.analystOutputs.length))
  let hasSpeculative = false
  for (const a of p.analystOutputs) {
    lines.push('')
    lines.push(`## newsId: ${a.newsId ?? '(none)'}`)
    lines.push(`primaryImpact: ${a.primaryImpact}`)
    if (a.cascadeChains.length > 0) {
      lines.push(`cascadeChains:`)
      for (const c of a.cascadeChains) {
        if (c.speculative)
          hasSpeculative = true
        const tierLabel = c.tier !== undefined ? ` [tier ${c.tier}]` : ''
        const parentLabel = c.parentChainId !== undefined ? SYNTHESIZER_USER_TEXT.parentLabel(c.parentChainId) : ''
        // 無 citation 的二階推演由程式判定標記、提示 LLM 以條件語氣呈現、不得作為 highlights 依據
        const speculativeLabel = c.speculative ? SYNTHESIZER_USER_TEXT.speculativeLabel : ''
        lines.push(`  - industry${tierLabel}: ${c.industry}${parentLabel}${speculativeLabel}`)
        lines.push(`    mechanism: ${c.mechanism}`)
        lines.push(`    direction: ${c.direction}`)
        lines.push(`    affectedTickers: ${c.affectedTickers.join(', ')}`)
        lines.push(`    citations:`)
        for (const cit of c.citations)
          lines.push(`      - ${cit.url}`)
      }
    }
    lines.push(`reasoning: ${a.reasoning}`)
  }
  // 只在存在 speculative chain 時 push 指示句、避免無謂 token
  if (hasSpeculative) {
    lines.push('')
    lines.push(SYNTHESIZER_USER_TEXT.speculativeNote)
  }
  if (p.marketCloseFraming) {
    lines.push('')
    lines.push(p.marketCloseFraming)
    lines.push(SYNTHESIZER_USER_TEXT.marketCloseFramingNote)
  }
  if (p.marketSnapshot) {
    lines.push('')
    lines.push(READER_SNAPSHOT_HEADING)
    lines.push(p.marketSnapshot)
  }
  if (p.continuityHint) {
    lines.push('')
    lines.push(SYNTHESIZER_USER_TEXT.continuityHeading)
    lines.push(p.continuityHint)
    lines.push(SYNTHESIZER_USER_TEXT.continuityNote)
  }
  return lines.join('\n')
}
