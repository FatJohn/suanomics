import type { EvidenceClaim, MarketBrief, Narrative } from '@suanomics/shared'
import type { CallNarrativeWriterParams, CallNarrativeWriterResult } from './narrative-writer.js'
import type { REVIEW_NOTE_KINDS } from './response-schemas.js'
import type { NewsItem } from './types.js'
import process from 'node:process'
import { NARRATIVE_REVIEWER_SYSTEM_PROMPT, NARRATIVE_REVISER_SYSTEM_PROMPT } from '../prompts/narrative-review.prompt.js'
import { formatReviewerUserContent, formatReviserUserContent } from '../prompts/narrative-review.user-content.js'
import { callAgent } from './call-agent.js'
import { CostGateError } from './cost-gate.js'
import { runNarrativeAttempts } from './narrative-writer.js'
import { NarrativeReviewResponse } from './response-schemas.js'

/**
 * narrative 之後固定一輪的審稿與修訂（#125）：審稿一次、有意見才修訂一次，不迴圈。
 * 任何一步失敗都保留原稿，審稿不能成為報告的新失敗點；只有花費閘錯誤往外丟。
 */

export interface NarrativeReviewMaterial {
  briefDate: string
  brief: MarketBrief
  news: NewsItem[]
  claimLedger: readonly EvidenceClaim[]
  mainThemes?: readonly string[]
  marketCloseFraming?: string | null
  marketSnapshot?: string | null
  calendarBlock?: string | null
  officialBlock?: string | null
  storylineBlock?: string | null
  closureBlock?: string | null
  weeklyRecapBlock?: string | null
}

export interface ReviewNote { kind: (typeof REVIEW_NOTE_KINDS)[number], quote: string, note: string }

export interface NarrativeReview { ok: boolean, notes: ReviewNote[] }

// 與 narrativeLedgerEnabled 同理在函式內讀 env：A/B 腳本要在同一個 process 內切換開關。
export function narrativeReviewEnabled(): boolean {
  return process.env.NARRATIVE_REVIEW_ENABLED === 'true'
}

export function reviewMaterialFromParams(p: CallNarrativeWriterParams): NarrativeReviewMaterial {
  return {
    briefDate: p.briefDate,
    brief: p.brief,
    news: p.news,
    claimLedger: p.claimLedger ?? [],
    ...(p.mainThemes ? { mainThemes: p.mainThemes } : {}),
    marketCloseFraming: p.marketCloseFraming ?? null,
    marketSnapshot: p.marketSnapshot ?? null,
    calendarBlock: p.calendarBlock ?? null,
    officialBlock: p.officialBlock ?? null,
    storylineBlock: p.storylineBlock ?? null,
    closureBlock: p.closureBlock ?? null,
    weeklyRecapBlock: p.weeklyRecapBlock ?? null,
  }
}

// 太短的引文幾乎對得上任何草稿，等於沒定位；太長的引文等於點名整段，修訂者會整段重寫。區間同 prompt。
const MIN_QUOTE_CHARS = 5
const MAX_QUOTE_CHARS = 60

function normalizeQuote(s: string): string {
  return s.normalize('NFKC').replace(/\s+/g, '')
}

// 小標與重點行修訂者必須逐字保留，點名它們的意見無法落實，不列入可比對範圍。
function draftTexts(draft: Narrative): string[] {
  return [draft.intro, ...draft.sections.map(s => s.body), draft.outro].map(normalizeQuote)
}

// 引文對不回草稿的意見無法定位要改哪一句，交給修訂者等於讓它自由改寫。
function locatableNotes(notes: readonly ReviewNote[], draft: Narrative): ReviewNote[] {
  const texts = draftTexts(draft)
  const seen = new Set<string>()
  return notes.filter((n) => {
    const q = normalizeQuote(n.quote)
    if (q.length < MIN_QUOTE_CHARS || q.length > MAX_QUOTE_CHARS || seen.has(q) || !texts.some(t => t.includes(q)))
      return false
    seen.add(q)
    return true
  })
}

/** 審稿一次；呼叫失敗回 null。 */
export async function reviewNarrative(m: NarrativeReviewMaterial, draft: Narrative): Promise<NarrativeReview | null> {
  try {
    const raw = await callAgent('narrative-reviewer', {
      systemPrompt: NARRATIVE_REVIEWER_SYSTEM_PROMPT,
      userContent: formatReviewerUserContent(m, draft),
    }, NarrativeReviewResponse)
    const notes = locatableNotes(raw.notes, draft)
    return { ok: notes.length === 0, notes }
  }
  catch (err) {
    if (err instanceof CostGateError)
      throw err
    console.warn(`[narrative-reviewer] fail message=${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}

/** 修訂只試一次：失敗回 narrative null，由呼叫端保留原稿，不重試也不再審。 */
export async function reviseNarrative(m: NarrativeReviewMaterial, draft: Narrative, notes: readonly ReviewNote[]): Promise<CallNarrativeWriterResult> {
  return runNarrativeAttempts(
    { brief: m.brief, news: m.news, citations: m.brief.citations, claimLedger: m.claimLedger },
    { agent: 'narrative-reviser', systemPrompt: NARRATIVE_REVISER_SYSTEM_PROMPT, userContent: formatReviserUserContent(m, draft, notes), maxAttempts: 1 },
  )
}

// prompt 要求其餘部分逐字保留，這裡只機械地擋得住結構層的越權改寫：段落數、小標、重點行。
function keepsStructure(draft: Narrative, revised: Narrative): boolean {
  return revised.sections.length === draft.sections.length
    && revised.sections.every((s, i) => s.heading === draft.sections[i]?.heading && s.takeaway === draft.sections[i]?.takeaway)
}

export async function reviewAndRevise(m: NarrativeReviewMaterial, first: CallNarrativeWriterResult): Promise<CallNarrativeWriterResult> {
  if (!narrativeReviewEnabled() || first.narrative === null)
    return first
  const draft = first.narrative
  const review = await reviewNarrative(m, draft)
  if (review === null || review.ok) {
    console.warn(JSON.stringify({ event: 'narrative_review', notes: 0, revised: false, reviewFailed: review === null }))
    return first
  }
  const revised = await reviseNarrative(m, draft, review.notes)
  const accepted = revised.narrative !== null && keepsStructure(draft, revised.narrative)
  console.warn(JSON.stringify({ event: 'narrative_review', notes: review.notes.length, kinds: review.notes.map(n => n.kind), revised: accepted, revisionFailed: revised.narrative === null }))
  return accepted ? revised : first
}
