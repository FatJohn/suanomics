import type { MarketBrief, Podcast } from '@suanomics/shared'
import type { LlmCallRecord } from './llm-wrapper.js'
import type { RetryReason } from './narrative-shared.js'
import {
  checkCompliance,
  makePodcastSchemaWithCitations,
  PodcastSchema,
} from '@suanomics/shared'
import { PODCAST_WRITER_SYSTEM_PROMPT } from '../prompts/podcast-writer.prompt.js'
import { PODCAST_WRITER_USER_TEXT } from '../prompts/podcast-writer.user-content.js'
import { callAgentLLM } from './llm-wrapper.js'
import { READER_SNAPSHOT_HEADING } from './market-snapshot-section.js'
import { clampString, classifyError, rewriteText } from './narrative-shared.js'
import { PODCAST_GEMINI_SCHEMA } from './podcast-writer-schema.js'
import { preNormalizePodcastRaw } from './podcast-writer.normalize.js'

export interface CallPodcastWriterParams {
  briefDate: string
  brief: MarketBrief
  // 本週財經行事曆 block（前瞻素材）、podcast worker 自行 loadMarketContext 注入、缺則略過
  calendarBlock?: string | null
  // 開放敘事線 block（追蹤線進展回顧）、缺則略過
  storylineBlock?: string | null
  // 今日市場數據 snapshot block（讀者面具名數字來源）；podcast worker 注入、缺則略過
  marketSnapshot?: string | null
  // 台股收盤時間框架 block（buildMarketCloseFraming、taiex-close 真實收盤日錨定今/昨）；
  // podcast worker 注入、缺（空字串 / null）則略過。defense-in-depth、與 narrative-writer 一致。
  marketCloseFraming?: string | null
  onCallRecord?: (r: LlmCallRecord) => void
}

export interface CallPodcastWriterResult {
  podcast: Podcast | null
  audit: {
    failed: boolean
    retryReason: RetryReason
    fabricationStripped: number
    forbiddenSanitized: number
  }
}

const MAX_ATTEMPTS = 2

export async function callPodcastWriter(
  p: CallPodcastWriterParams,
): Promise<CallPodcastWriterResult> {
  const userContent = formatUserContent(p)
  const allowedCitationUrls = p.brief.citations.map(c => c.url)
  const validatingSchema = makePodcastSchemaWithCitations(allowedCitationUrls)

  let firstFailReason: RetryReason = null

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const raw = await callAgentLLM<unknown>({
        agentName: 'podcast-writer',
        systemPrompt: PODCAST_WRITER_SYSTEM_PROMPT,
        userContent,
        responseSchema: PODCAST_GEMINI_SCHEMA,
        ...(p.onCallRecord !== undefined ? { onCallRecord: p.onCallRecord } : {}),
      })

      const normalized = preNormalizePodcastRaw(raw, allowedCitationUrls, p.briefDate)
      const parsed = validatingSchema.parse(normalized)

      const { sanitized, count: forbiddenCount } = sanitizePodcastForbidden(parsed)
      const reChecked = recomputeTotalChars(sanitized)
      // sanitizePodcastForbidden 只改 hook/act/takeaway 的 string body、不動 citationUrls
      // 所以 validatingSchema.parse(normalized) 已經保證的 citation subset 不變、PodcastSchema 即可重 validate
      // 若未來擴展 sanitize 觸及 URL 欄位、需要回頭用 validatingSchema.parse 重新檢查 subset
      const final = PodcastSchema.parse(reChecked)

      // 硬 gate：掃 sanitize 後仍殘留的硬禁用詞（rewrite-map 外、如「建議買」）。
      // violation → throw → 走既有 catch → retry → 第二次仍違規 degrade 成 null（比照 narrative-writer 的既有作法）。
      const violation = checkCompliance(podcastProseText(final))
      if (violation)
        throw new Error(`podcast compliance violation: ${violation.matched}`)

      emitAudit(p.onCallRecord, {
        failed: false,
        retryReason: null,
        fabricationStripped: 0,
        forbiddenSanitized: forbiddenCount,
      })

      return {
        podcast: final,
        audit: { failed: false, retryReason: null, fabricationStripped: 0, forbiddenSanitized: forbiddenCount },
      }
    }
    catch (err) {
      const reason = classifyError(err)
      const e = err as { message?: string, issues?: unknown }
      console.warn(`[podcast-writer] attempt ${attempt} fail reason=${reason} message=${e.message ?? '(unknown)'}`)
      if (e.issues)
        console.warn(`[podcast-writer] zod issues:`, JSON.stringify(e.issues).slice(0, 800))
      if (attempt === 1)
        firstFailReason = reason
      if (attempt >= MAX_ATTEMPTS) {
        emitAudit(p.onCallRecord, {
          failed: true,
          retryReason: firstFailReason,
          fabricationStripped: 0,
          forbiddenSanitized: 0,
        })
        return {
          podcast: null,
          audit: { failed: true, retryReason: firstFailReason, fabricationStripped: 0, forbiddenSanitized: 0 },
        }
      }
    }
  }
  return {
    podcast: null,
    audit: { failed: true, retryReason: 'zod-parse', fabricationStripped: 0, forbiddenSanitized: 0 },
  }
}

function emitAudit(
  onCall: ((r: LlmCallRecord) => void) | undefined,
  audit: { failed: boolean, retryReason: RetryReason, fabricationStripped: number, forbiddenSanitized: number },
) {
  if (!onCall)
    return
  onCall({
    agentName: 'podcast-writer',
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    latencyMs: 0,
    attempts: 0,
    podcastFailed: audit.failed,
    podcastRetryReason: audit.retryReason,
    podcastForbiddenSanitized: audit.forbiddenSanitized,
  })
}

function sanitizePodcastForbidden(p: Podcast): { sanitized: Podcast, count: number } {
  const counter = { count: 0 }
  const sanitized: Podcast = {
    ...p,
    hook: {
      headline: rewriteText(p.hook.headline, counter),
      body: rewriteText(p.hook.body, counter),
    },
    acts: p.acts.map(a => ({
      ...a,
      body: rewriteText(a.body, counter),
      actTitle: rewriteText(a.actTitle, counter),
    })),
    takeaway: { body: rewriteText(p.takeaway.body, counter) },
  }
  return { sanitized, count: counter.count }
}

function recomputeTotalChars(p: Podcast): Podcast {
  const total
    = p.hook.body.length
      + p.acts.reduce((sum, a) => sum + a.body.length, 0)
      + p.takeaway.body.length
  return {
    ...p,
    meta: {
      ...p.meta,
      totalChars: Math.min(2800, Math.max(1800, total)),
      generatedAt: new Date().toISOString(),
    },
  }
}

// 把 podcast 所有 reader-facing prose 拼成一字串、供 checkCompliance 硬 gate 掃描
function podcastProseText(p: Podcast): string {
  const parts: string[] = [p.hook.headline, p.hook.body]
  for (const a of p.acts) parts.push(a.actTitle, a.body)
  parts.push(p.takeaway.body)
  return parts.join('\n')
}

function formatUserContent(p: CallPodcastWriterParams): string {
  const lines: string[] = []
  lines.push(PODCAST_WRITER_USER_TEXT.intro(p.briefDate))
  lines.push('')
  lines.push(PODCAST_WRITER_USER_TEXT.readingNarrativeHeading)
  if (p.brief.narrative) {
    lines.push(`intro: ${p.brief.narrative.intro}`)
    lines.push(`outro: ${p.brief.narrative.outro}`)
    lines.push('sections:')
    for (const s of p.brief.narrative.sections) {
      lines.push(`  - ${s.heading}: ${clampString(s.body, 200)}`)
    }
  }
  else {
    lines.push(PODCAST_WRITER_USER_TEXT.narrativeEmptyFallback)
  }
  lines.push('')
  lines.push('## 2. Brief headline / summary / reasoning')
  lines.push(`headline: ${p.brief.headline}`)
  lines.push(`summary: ${p.brief.summary}`)
  lines.push(`reasoning: ${p.brief.reasoningChain.join(' → ')}`)
  lines.push('')
  lines.push(PODCAST_WRITER_USER_TEXT.cascadeChainsHeading)
  if (p.brief.cascadeChains && p.brief.cascadeChains.length > 0) {
    for (const c of p.brief.cascadeChains) {
      const tier = c.tier !== undefined ? `tier ${c.tier}` : 'tier ?'
      lines.push(`  - [${tier}] ${c.industry} → ${c.affectedTickers.join(', ')}: ${clampString(c.mechanism, 200)}`)
    }
  }
  else {
    lines.push(PODCAST_WRITER_USER_TEXT.cascadeChainsEmpty)
  }
  lines.push('')
  lines.push(PODCAST_WRITER_USER_TEXT.citationsHeading(p.brief.citations.length))
  for (const c of p.brief.citations) {
    lines.push(`  - url: ${c.url} | title: ${clampString(c.title, 60)}`)
  }
  lines.push('')
  if (p.brief.newsTitlesById) {
    lines.push(PODCAST_WRITER_USER_TEXT.newsIdsHeading(Object.keys(p.brief.newsTitlesById).length))
    for (const [id, title] of Object.entries(p.brief.newsTitlesById)) {
      lines.push(`  - id=${id}: ${clampString(title, 60)}`)
    }
  }
  // 台股收盤時間框架（自帶標頭與規則）先於市場數據、讓「今日/昨日」錨定在數字之前。
  if (p.marketCloseFraming) {
    lines.push('')
    lines.push(p.marketCloseFraming)
  }
  if (p.marketSnapshot) {
    lines.push('')
    lines.push(READER_SNAPSHOT_HEADING)
    lines.push(p.marketSnapshot)
  }
  lines.push('')
  // 行事曆 block 自帶「## 本週財經行事曆」標頭、wrapper 標題改指示句避免語意重複
  if (p.calendarBlock) {
    lines.push('')
    lines.push(PODCAST_WRITER_USER_TEXT.calendarSectionHeading)
    lines.push(p.calendarBlock)
  }
  if (p.storylineBlock) {
    lines.push('')
    lines.push(PODCAST_WRITER_USER_TEXT.storylineSectionHeading)
    lines.push(p.storylineBlock)
  }
  lines.push('')
  lines.push(PODCAST_WRITER_USER_TEXT.outputInstruction)
  return lines.join('\n')
}
