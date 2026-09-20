import type { SeriesAnchor } from '@suanomics/shared'
import type { CitableSeries } from '../market-data/snapshot.js'
import type { LlmCallRecord } from './llm-wrapper.js'
import type { AnalystOutput, CascadeChain, DecomposerOutput, RetrievedArticle } from './types.js'
import { ANALYST_TIER1_SYSTEM_PROMPT } from '../prompts/analyst-tier1.prompt.js'
import { ANALYST_TIER1_USER_TEXT } from '../prompts/analyst-tier1.user-content.js'
import { CLAIMS_GEMINI_SCHEMA, CLAIMS_PROMPT_SECTION, claimsEnabled, normalizeClaims, renderCitableSeriesSection } from './analyst-claims.js'
import { normalizeForAnalystSchema } from './analyst-shared.js'
import { callAgentLLM } from './llm-wrapper.js'
import { appendMarketSnapshotSection } from './market-snapshot-section.js'
import { relativeDayLabel } from './relative-time.js'
import { AnalystOutputSchema } from './types.js'

function isHttpUrl(s: string): boolean {
  try {
    const { protocol } = new URL(s)
    return protocol === 'http:' || protocol === 'https:'
  }
  catch {
    return false
  }
}

const RESPONSE_TIER1_GEMINI_SCHEMA = {
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
          // tier 1 Analyst 自提名 — 不放 required、避免 Gemini 對「沒下游」chain 硬掰
          nextTierEntities: {
            type: 'array',
            items: { type: 'string' },
            maxItems: 5,
          },
        },
        required: ['industry', 'mechanism', 'affectedTickers', 'direction', 'citations'],
      },
    },
    reasoning: { type: 'string' },
  },
  required: ['primaryImpact', 'cascadeChains', 'reasoning'],
}

export interface CallAnalystTier1Params {
  newsTitle: string
  newsText: string
  newsId?: string
  // 主新聞真 url：當作可引用來源（daily-brief 路徑帶入、single-news 路徑可不帶）
  newsUrl?: string
  // 時間框架：主新聞發布時間（UTC ISO）+ 報告日 D（'YYYY-MM-DD'）。供標注相對時間。
  publishedAt?: string | null
  // 報告日（台北曆日）必填：它會流進 EvidenceClaim 的 asOf，
  // 從前這裡有個回退到台北當日的預設，讓 analyze 路徑安靜地把 asOf 綁到執行時刻。
  briefDate: string
  decomposed: DecomposerOutput
  retrieved: RetrievedArticle[]
  priorChains?: CascadeChain[]
  marketSnapshot?: string | null
  // 市場收盤時間框架 block（台股結構化錨）；orchestrator 注入、缺則略過
  marketCloseFraming?: string | null
  // 可掛 series evidenceRef 的序列（seriesId + asOf）。
  // 只在 ANALYST_CLAIMS_ENABLED=true 時進 prompt；缺或空則整段略過。
  citableSeries?: readonly CitableSeries[]
  // auto-attach 用的快照序列點（含前值、帶數值）。**不進 prompt**。
  // 缺或空則不補任何 ref——那等於整份量測的 grounding 靜默歸零，所以呼叫端一定要傳。
  seriesAnchors?: readonly SeriesAnchor[]
  onCallRecord?: (r: LlmCallRecord) => void
  maxFabricationRetries?: number
}

export async function callAnalystTier1(p: CallAnalystTier1Params): Promise<AnalystOutput> {
  const allowedUrls = new Set(p.retrieved.map(r => r.url))
  if (p.newsUrl !== undefined && isHttpUrl(p.newsUrl))
    allowedUrls.add(p.newsUrl)
  const maxRetries = p.maxFabricationRetries ?? 3

  const wantClaims = claimsEnabled()
  const baseUserContent = formatUserContent(p, wantClaims)
  const systemPrompt = wantClaims
    ? `${ANALYST_TIER1_SYSTEM_PROMPT}\n\n${CLAIMS_PROMPT_SECTION}`
    : ANALYST_TIER1_SYSTEM_PROMPT
  const responseSchema = wantClaims
    ? {
        ...RESPONSE_TIER1_GEMINI_SCHEMA,
        properties: { ...RESPONSE_TIER1_GEMINI_SCHEMA.properties, claims: CLAIMS_GEMINI_SCHEMA },
      }
    : RESPONSE_TIER1_GEMINI_SCHEMA
  let attempts = 0
  let feedback = ''

  // 我們需要在最後一次 call（若觸發 strip）的 record 上標記 fabricationStripped、
  // 因此 buffer 最後一筆 record 延遲到判斷完才 forward；前面的 record 直接 forward。
  let lastRecord: LlmCallRecord | null = null
  const flushLastRecord = (extras?: Partial<LlmCallRecord>) => {
    if (!lastRecord)
      return
    const enriched: LlmCallRecord = extras ? { ...lastRecord, ...extras } : lastRecord
    p.onCallRecord?.(enriched)
    lastRecord = null
  }
  const captureRecord = (r: LlmCallRecord) => {
    // 上一筆 record 還沒 flush（前一個 retry 的 record）→ 直接 forward 不變
    if (lastRecord)
      p.onCallRecord?.(lastRecord)
    lastRecord = r
  }

  while (attempts < maxRetries) {
    attempts++
    const userContent = feedback ? `${baseUserContent}\n\n${feedback}` : baseUserContent
    const raw = await callAgentLLM<unknown>({
      agentName: 'analyst-tier1',
      systemPrompt,
      userContent,
      responseSchema,
      // GOTCHA: use conditional spread for optional fields (exactOptionalPropertyTypes)
      ...(p.newsId !== undefined ? { newsId: p.newsId } : {}),
      onCallRecord: captureRecord,
    })
    // claims 一律由 code 覆寫：關閉時強制空陣列、開啟時走 normalizeClaims。
    // 直接把 LLM 的原始 claims 餵進 schema 會讓一條壞 claim throw 掉整份分析——
    // 那正是這裡要避免的事。
    const normalized = normalizeForAnalystSchema(raw)
    const rawClaims = raw && typeof raw === 'object' ? (raw as { claims?: unknown }).claims : undefined
    const parsed = AnalystOutputSchema.parse({
      ...(normalized as Record<string, unknown>),
      claims: wantClaims
        ? normalizeClaims(rawClaims, p.briefDate, p.seriesAnchors ?? [])
        : [],
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
      // 最終 retry 仍有幻覺 url — strip fabricated 而非 throw、讓 analyzer 走 graceful degradation
      console.warn('[analyst-tier1] %d fabricated citations after %d retries, stripping', fabricated.length, maxRetries)
      flushLastRecord({ fabricationStripped: fabricated.length })
      return {
        ...parsed,
        cascadeChains: parsed.cascadeChains.map(c => ({
          ...c,
          citations: c.citations.filter(cit => allowedUrls.has(cit.url)),
        })),
      }
    }
    feedback = ANALYST_TIER1_USER_TEXT.fabricationFeedback(fabricated, [...allowedUrls])
  }
  // unreachable but for ts
  throw new Error(`analyst-tier1: unreachable`)
}

function formatUserContent(p: CallAnalystTier1Params, wantClaims: boolean): string {
  const lines: string[] = []
  lines.push(ANALYST_TIER1_USER_TEXT.mainNewsHeading)
  lines.push(ANALYST_TIER1_USER_TEXT.newsTitleHeading(p.newsTitle))
  const label = relativeDayLabel(p.publishedAt, p.briefDate)
  if (label)
    lines.push(ANALYST_TIER1_USER_TEXT.publishedAtHeading(label))
  lines.push(ANALYST_TIER1_USER_TEXT.newsBodyHeading(p.newsText))
  lines.push('')
  lines.push(ANALYST_TIER1_USER_TEXT.decomposerResultHeading)
  lines.push(`primaryEntity: ${JSON.stringify(p.decomposed.primaryEntity)}`)
  lines.push(`topicTags: ${p.decomposed.topicTags.join(', ')}`)
  lines.push(`cascadeHypotheses:`)
  for (const h of p.decomposed.cascadeHypotheses) {
    lines.push(`  - industry: ${h.industry}`)
    lines.push(`    mechanism: ${h.mechanism}`)
  }
  lines.push('')
  const citable: { url: string, title: string, summary?: string | null }[] = []
  if (p.newsUrl !== undefined && isHttpUrl(p.newsUrl))
    citable.push({ url: p.newsUrl, title: p.newsTitle, summary: ANALYST_TIER1_USER_TEXT.primaryNewsCitableSummary })
  for (const r of p.retrieved)
    citable.push({ url: r.url, title: r.title, summary: r.contentSummary })

  if (citable.length === 0) {
    lines.push(ANALYST_TIER1_USER_TEXT.noCitableSourcesHeading)
    lines.push(ANALYST_TIER1_USER_TEXT.noCitableSourcesNote)
  }
  else {
    lines.push(ANALYST_TIER1_USER_TEXT.citableSourcesHeading)
    for (const c of citable) {
      lines.push(`- url: ${c.url}`)
      lines.push(`  title: ${c.title}`)
      if (c.summary)
        lines.push(`  summary: ${c.summary}`)
    }
  }
  if (p.priorChains && p.priorChains.length > 0) {
    lines.push('')
    lines.push(ANALYST_TIER1_USER_TEXT.priorChainsHeading)
    for (const c of p.priorChains.slice(0, 8)) {
      lines.push(`- ${c.industry}: ${c.mechanism}`)
    }
  }
  if (p.marketCloseFraming) {
    lines.push('')
    lines.push(p.marketCloseFraming)
  }
  appendMarketSnapshotSection(lines, p.marketSnapshot)
  if (wantClaims)
    renderCitableSeriesSection(lines, p.citableSeries ?? [])
  return lines.join('\n')
}
