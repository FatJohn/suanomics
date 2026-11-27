import type { MarketBrief, Podcast } from '@suanomics/shared'
import type { LlmCallRecord } from './call-agent.js'
import type { RetryReason } from './narrative-shared.js'
import {
  checkCompliance,
  makePodcastSchemaWithCitations,
} from '@suanomics/shared'
import { PODCAST_WRITER_SYSTEM_PROMPT } from '../prompts/podcast-writer.prompt.js'
import { PODCAST_WRITER_USER_TEXT } from '../prompts/podcast-writer.user-content.js'
import { callAgent } from './call-agent.js'
import { CostGateError } from './cost-gate.js'
import { READER_SNAPSHOT_HEADING } from './market-snapshot-section.js'
import { clampString, classifyError } from './narrative-shared.js'
import { preNormalizePodcastRaw } from './podcast-writer.normalize.js'
import { PodcastWriterResponse } from './response-schemas.js'

export interface CallPodcastWriterParams {
  briefDate: string
  brief: MarketBrief
  // 本週財經行事曆 block（前瞻素材）、缺則略過
  calendarBlock?: string | null
  // 開放敘事線 block（追蹤線進展回顧）、缺則略過
  storylineBlock?: string | null
  // 今日市場數據 snapshot block（讀者面具名數字來源）；缺則略過
  marketSnapshot?: string | null
  // 台股收盤時間框架 block（buildMarketCloseFraming、taiex-close 真實收盤日錨定今/昨）；
  // 缺（空字串 / null）則略過。defense-in-depth、與 narrative-writer 一致。
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

class ComplianceResidualError extends Error {
  constructor(matched: string) {
    super(`podcast compliance violation: ${matched}`)
  }
}

export async function callPodcastWriter(
  p: CallPodcastWriterParams,
): Promise<CallPodcastWriterResult> {
  const userContent = formatUserContent(p)
  const allowedCitationUrls = p.brief.citations.map(c => c.url)
  const validatingSchema = makePodcastSchemaWithCitations(allowedCitationUrls)

  let firstFailReason: RetryReason = null

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const raw = await callAgent('podcast-writer', { systemPrompt: PODCAST_WRITER_SYSTEM_PROMPT, userContent }, PodcastWriterResponse, {
        ...(p.onCallRecord !== undefined ? { onCallRecord: p.onCallRecord } : {}),
      })

      const counter = { count: 0 }
      const normalized = preNormalizePodcastRaw(raw, allowedCitationUrls, p.briefDate, counter)
      const final = validatingSchema.parse(normalized)
      const forbiddenCount = counter.count

      // 硬 gate：掃 sanitize 後仍殘留的硬禁用詞（rewrite-map 外、如「建議買」）。
      // violation → throw → 走既有 catch → retry → 第二次仍違規 degrade 成 null（比照 narrative-writer 的既有作法）。
      const violation = checkCompliance(podcastProseText(final))
      if (violation)
        throw new ComplianceResidualError(violation.matched)

      return {
        podcast: final,
        audit: { failed: false, retryReason: null, fabricationStripped: 0, forbiddenSanitized: forbiddenCount },
      }
    }
    catch (err) {
      // 花費閘或帳戶錯誤重試也不會過，交給呼叫端決定。
      if (err instanceof CostGateError)
        throw err
      const reason = err instanceof ComplianceResidualError ? 'compliance-residual' : classifyError(err)
      const e = err as { message?: string, issues?: unknown }
      console.warn(`[podcast-writer] attempt ${attempt} fail reason=${reason} message=${e.message ?? '(unknown)'}`)
      if (e.issues)
        console.warn(`[podcast-writer] zod issues:`, JSON.stringify(e.issues).slice(0, 800))
      if (attempt === 1)
        firstFailReason = reason
      if (attempt >= MAX_ATTEMPTS) {
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
