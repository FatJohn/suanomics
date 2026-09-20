import type { LlmCallRecord } from './llm-wrapper.js'
import type { AnalystOutput, RetrievedArticle } from './types.js'
import { ANALYST_TIER2_SYSTEM_PROMPT } from '../prompts/analyst-tier2.prompt.js'
import { ANALYST_TIER2_USER_TEXT } from '../prompts/analyst-tier2.user-content.js'
import { normalizeForAnalystSchema } from './analyst-shared.js'
import { callAgentLLM } from './llm-wrapper.js'
import { appendMarketSnapshotSection } from './market-snapshot-section.js'
import { AnalystOutputSchema } from './types.js'

const RESPONSE_TIER2_GEMINI_SCHEMA = {
  type: 'object',
  properties: {
    newsId: { type: 'string' },
    primaryImpact: { type: 'string' },
    cascadeChains: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          industry: { type: 'string' },
          mechanism: { type: 'string' },
          affectedTickers: { type: 'array', items: { type: 'string' } },
          direction: { type: 'string', enum: ['positive', 'neutral', 'negative'] },
          citations: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                url: { type: 'string' },
                title: { type: 'string' },
                quote: { type: 'string' },
              },
              required: ['url', 'title', 'quote'],
            },
            minItems: 0,
            maxItems: 5,
          },
          // 結構性禁止 nextTierEntities：Gemini structured output 對 unknown property 會 strip
          // → tier 2 chain 永不產 nextTierEntities、recursion bound = 2
        },
        required: ['industry', 'mechanism', 'affectedTickers', 'direction', 'citations'],
      },
    },
    reasoning: { type: 'string' },
  },
  required: ['primaryImpact', 'cascadeChains', 'reasoning'],
}

export interface CallAnalystTier2Params {
  newsTitle: string
  newsText: string
  newsId?: string
  parentChain: {
    chainId: string
    industry: string
    mechanism: string
    nextTierEntities: string[]
  }
  retrieved: RetrievedArticle[]
  marketSnapshot?: string | null
  onCallRecord?: (r: LlmCallRecord) => void
  maxFabricationRetries?: number
}

// callAnalystTier2: 給定一條 tier 1 chain context + 用 nextTierEntities 撈到的
// retrieved articles、產 tier 2 cascadeChains（聚焦於 tier 1 partner 的傳導機制）。
// 沿用 tier 1 的 fabrication-strip / retry pattern。
export async function callAnalystTier2(p: CallAnalystTier2Params): Promise<AnalystOutput> {
  const allowedUrls = new Set(p.retrieved.map(r => r.url))
  const maxRetries = p.maxFabricationRetries ?? 3
  const baseUserContent = formatTier2UserContent(p)

  let attempts = 0
  let feedback = ''
  let lastRecord: LlmCallRecord | null = null
  const flushLastRecord = (extras?: Partial<LlmCallRecord>) => {
    if (!lastRecord)
      return
    const enriched: LlmCallRecord = extras ? { ...lastRecord, ...extras } : lastRecord
    p.onCallRecord?.(enriched)
    lastRecord = null
  }
  const captureRecord = (r: LlmCallRecord) => {
    if (lastRecord)
      p.onCallRecord?.(lastRecord)
    lastRecord = r
  }

  while (attempts < maxRetries) {
    attempts++
    const userContent = feedback ? `${baseUserContent}\n\n${feedback}` : baseUserContent
    const raw = await callAgentLLM<unknown>({
      agentName: 'analyst-tier2',
      systemPrompt: ANALYST_TIER2_SYSTEM_PROMPT,
      userContent,
      responseSchema: RESPONSE_TIER2_GEMINI_SCHEMA,
      ...(p.newsId !== undefined ? { newsId: p.newsId } : {}),
      onCallRecord: captureRecord,
    })
    // tier2 不產 claim，但與 tier1 共用 AnalystOutputSchema。供應商若自行回了 claims，
    // 一條壞 claim 會 throw 掉整份 tier2 分析——強制覆寫成空陣列，讓那條路徑不存在。
    const parsed = AnalystOutputSchema.parse({
      ...(normalizeForAnalystSchema(raw) as Record<string, unknown>),
      claims: [],
    })
    if (parsed.newsId === undefined && p.newsId !== undefined)
      parsed.newsId = p.newsId

    const fabricated = parsed.cascadeChains.flatMap(c =>
      c.citations.filter(cit => !allowedUrls.has(cit.url)).map(cit => cit.url),
    )
    if (fabricated.length === 0) {
      flushLastRecord()
      return parsed
    }
    if (attempts >= maxRetries) {
      console.warn('[analyst-tier2] %d fabricated citations after %d retries, stripping', fabricated.length, maxRetries)
      flushLastRecord({ fabricationStripped: fabricated.length })
      return {
        ...parsed,
        cascadeChains: parsed.cascadeChains.map(c => ({
          ...c,
          citations: c.citations.filter(cit => allowedUrls.has(cit.url)),
        })),
      }
    }
    feedback = ANALYST_TIER2_USER_TEXT.fabricationFeedback(fabricated, [...allowedUrls])
  }
  throw new Error(`analyst-tier2: unreachable`)
}

function formatTier2UserContent(p: CallAnalystTier2Params): string {
  const lines: string[] = []
  lines.push(ANALYST_TIER2_USER_TEXT.mainNewsHeading)
  lines.push(ANALYST_TIER2_USER_TEXT.newsTitleHeading(p.newsTitle))
  lines.push(ANALYST_TIER2_USER_TEXT.newsBodyHeading(p.newsText))
  lines.push('')
  lines.push(ANALYST_TIER2_USER_TEXT.tier1ChainHeading)
  lines.push(`- industry: ${p.parentChain.industry}`)
  lines.push(`- mechanism: ${p.parentChain.mechanism}`)
  lines.push(ANALYST_TIER2_USER_TEXT.nominatedPartnersLine(p.parentChain.nextTierEntities.join(', ')))
  lines.push('')
  if (p.retrieved.length === 0) {
    lines.push(ANALYST_TIER2_USER_TEXT.emptyRetrieverHeading)
    lines.push(ANALYST_TIER2_USER_TEXT.emptyRetrieverNote)
  }
  else {
    lines.push(ANALYST_TIER2_USER_TEXT.retrieverHeading)
    lines.push(ANALYST_TIER2_USER_TEXT.retrieverNote)
    for (const r of p.retrieved) {
      lines.push(`- url: ${r.url}`)
      lines.push(`  title: ${r.title}`)
      if (r.contentSummary)
        lines.push(`  summary: ${r.contentSummary}`)
    }
  }
  appendMarketSnapshotSection(lines, p.marketSnapshot)
  return lines.join('\n')
}
