import type { EvidenceClaim, MarketBrief, MarketBriefCitation, Narrative } from '@suanomics/shared'
import type { LlmCallRecord } from './llm-wrapper.js'
import type { RetryReason } from './narrative-shared.js'
import type { NewsItem } from './orchestrator.js'
import type { AnalystOutput } from './types.js'
import process from 'node:process'
import {

  checkCompliance,
  formatClaimLedgerBlock,
  MarketBriefSchema,

} from '@suanomics/shared'
import { NARRATIVE_CLAIM_LEDGER_INSTRUCTION, NARRATIVE_GEMINI_SCHEMA, NARRATIVE_WRITER_SYSTEM_PROMPT, NARRATIVE_WRITER_WEEKEND_SYSTEM_PROMPT } from '../prompts/narrative-writer.prompt.js'
import { NARRATIVE_WRITER_USER_TEXT } from '../prompts/narrative-writer.user-content.js'
import { callAgentLLM } from './llm-wrapper.js'
import { READER_SNAPSHOT_HEADING } from './market-snapshot-section.js'
import { checkNarrativeClaimBinding, warnClaimBindingIssues } from './narrative-claim-binding.js'
import {
  clampString,
  classifyError,

  rewriteText,
} from './narrative-shared.js'
import { clampNarrativeStringFields, preNormalizeNarrativeRaw } from './narrative-writer.normalize.js'
import { relativeDayLabel } from './relative-time.js'

// narrative-writer retry reason 直接用 shared RetryReason、保留 alias
// 為了讓 narrative-writer 內部 naming 不變、降低 diff 範圍
type NarrativeRetryReason = RetryReason

// NarrativeWriter wrapper
// 流程：
//   1. callAgentLLM (timeout 60s、callAgentLLM 內部已含 Gemini network retry)
//   2. Zod parse via MarketBriefSchema (含 superRefine citation subset)
//   3. Sanitize forbidden + ticker-direction in-place（沿用 SAFE_REWRITE_MAP、不 retry）
//   4. Clamp string fields（防 sanitize 撐爆 max 400/250）
//   5. Final Zod re-parse sanity check
// Retry：1 retry on (1) Zod fail (2) Gemini API fail、第二次失敗 → null + audit

export interface CallNarrativeWriterParams {
  brief: MarketBrief
  analystOutputs: AnalystOutput[]
  news: NewsItem[]
  citations: MarketBriefCitation[]
  // 本週財經行事曆 block（前瞻素材）、orchestrator Stage 0 注入、缺則略過
  calendarBlock?: string | null
  // 開放敘事線 block（追蹤線進展回顧）、orchestrator 直通、缺則略過
  storylineBlock?: string | null
  // 官方公告 block（央行／金管會／證交所一手公告）。與 calendarBlock 同一類：**只可引用
  // 列出的內容**，不可據此推論未列出的數字或政策。
  officialBlock?: string | null
  // editor 當日主軸、narrative 組織骨幹（editor 失敗 fallback 時 undefined → prompt 指示自推）
  mainThemes?: string[]
  // 本日論點脊椎、intro 立論／sections 用內容承接／outro 回到主線收尾（措辭見 formatUserContent）
  dailyThesis?: string
  // 時間框架：報告日 D（'YYYY-MM-DD'）、用於相對時間標籤 + 取代 new Date()
  briefDate: string
  // 市場收盤時間框架 block（台股結構化錨）；orchestrator 注入、缺則略過
  marketCloseFraming?: string | null
  // 今日市場數據 snapshot block（讀者面具名數字來源）；orchestrator 注入、缺則略過
  marketSnapshot?: string | null
  // 合併去重後的 claim ledger（orchestrator 注入）。目前只用它的 id 當白名單、
  // strip 掉模型掛上的未知 claimId；缺（undefined）＝視同空 ledger、所有 claimIds 都被 strip。
  claimLedger?: readonly EvidenceClaim[]
  // 週末模式（weekend=週日特輯）、預設 weekday；weekend 時 narrative-writer 用週末 prompt + 本週回顧素材
  reportKind?: 'weekday' | 'weekend'
  weeklyRecapBlock?: string | null
  onCallRecord?: (r: LlmCallRecord) => void
}

export interface CallNarrativeWriterResult {
  narrative: Narrative | null
  audit: {
    failed: boolean
    retryReason: NarrativeRetryReason
    fabricationStripped: number
    // 被 strip 的未知 claimId 數（成功那次 attempt 的值；degrade 時為 0）。
    // 非 0 代表模型掛了 ledger 裡沒有的 claim——traceability 的分母要看它。
    claimIdsStripped: number
    // claim 帶了 citation ref 但 url 不在 brief.citations 而被丟掉的個數。
    // 非 0 代表 claim 的 ref 與 citations 對不上，那條 section 已退回讓模型自己挑出處。
    claimCitationUrlsDropped: number
    // citationUrls 真的由 claim 反推決定的 section 數。
    claimCitationSections: number
    // narrative section 的受檢數字裡，對不回**本段自己掛的 claim** 的個數。
    // 與 claimIdsStripped 問的不是同一件事：那個問「掛的 id 存不存在」，這個問「用的數字
    // 是不是那幾條 claim 給的」。2026-08-09 prod 實例——對整池比對的 traceability ①是
    // 41/42（97.6%）全綠，這個判準下是 1/26，抓出的正是那句正負號相反的敘述。
    claimUnboundNumbers: number
    // 上一項的分母（僅 section 內；intro/outro 沒有 claimIds 掛載點、無從收緊、不計入）。
    claimCheckedNumbers: number
    // 因 `max 8` 上限被截掉的 claimId 數（去重後計算）。判讀 unbound 的必要脈絡——
    // 非 0 時，unbound 有可能是「模型宣稱了但掛不上」而不是「模型亂用數字」。
    claimIdsTruncated: number
  }
}

const MAX_ATTEMPTS = 2

/**
 * 總開關，**預設關閉**。
 *
 * 關閉時送給 LLM 的 systemPrompt 與 userContent 逐字與加這個旗標之前相同——narrative 是讀者面
 * 的主文，部署啟用每日排程後，這裡的改動部署上去就會反映進報告，
 * 沒有人工複核這一關，而 canary 量不到 prompt 改動。
 *
 * 在函式內讀 env（而非 module 載入時）是刻意的：A/B 量測腳本要在同一個 process 內跑
 * 開／關兩臂，module-level 讀取會把第一次的值凍住、兩臂拿到同一份設定而看起來「沒有差異」。
 * 這條照抄 `analyst-claims.ts` 的 `claimsEnabled()`，不是新規定。
 */
export function narrativeLedgerEnabled(): boolean {
  return process.env.NARRATIVE_LEDGER_ENABLED === 'true'
}

/**
 * 這次呼叫要不要讓 narrative 消費 ledger。旗標開**且**真的有 claim 才算數：
 * 空 ledger 時連指示段都不 append，避免 prompt 裡出現一段講「## 4.」但 user content
 * 根本沒有「## 4.」的懸空指示。
 */
function ledgerInPrompt(p: CallNarrativeWriterParams): boolean {
  return narrativeLedgerEnabled() && (p.claimLedger?.length ?? 0) > 0
}

// 把 narrative 所有 reader-facing prose 拼成一個字串、供 checkCompliance 掃描
function narrativeProseText(n: Narrative): string {
  const parts: string[] = [n.intro]
  // takeaway 是讀者面粗體結論行、與 heading/body 同樣要進合規掃描
  for (const s of n.sections) parts.push(s.heading, s.takeaway ?? '', s.body)
  parts.push(n.outro)
  return parts.join('\n')
}

export async function callNarrativeWriter(
  p: CallNarrativeWriterParams,
): Promise<CallNarrativeWriterResult> {
  const withLedger = ledgerInPrompt(p)
  const userContent = formatUserContent(p, withLedger)
  // weekend 時用週末 prompt（本週回顧 + 下週前瞻）、預設 weekday 沿用日報 prompt
  const basePrompt = p.reportKind === 'weekend'
    ? NARRATIVE_WRITER_WEEKEND_SYSTEM_PROMPT
    : NARRATIVE_WRITER_SYSTEM_PROMPT
  // ledger 指示只在旗標開且有 claim 時 append（關閉時 base prompt 逐字不變）
  const systemPrompt = withLedger ? basePrompt + NARRATIVE_CLAIM_LEDGER_INSTRUCTION : basePrompt

  let firstFailReason: NarrativeRetryReason = null
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const raw = await callAgentLLM<unknown>({
        agentName: 'narrative-writer',
        systemPrompt,
        userContent,
        responseSchema: NARRATIVE_GEMINI_SCHEMA,
        // GOTCHA: exactOptionalPropertyTypes — conditional spread for optional fields
        ...(p.onCallRecord !== undefined ? { onCallRecord: p.onCallRecord } : {}),
      })

      // clamp BEFORE parse（沿用 synthesizer.ts normalizeForSynthesizerSchema pattern）
      // Gemini 偶會超 schema max（intro>250 / body>400 / outro>250）、與其讓 Zod 直接 throw
      // 整批 retry、不如先 truncate 再 parse、保留 narrative 連續性。
      // 加 citationUrls 過濾 + 空集 fallback：drop unknown urls、若空則塞 first valid url
      const validCitationUrls = p.citations.map(c => c.url)
      const validNewsIds = p.news.map(n => n.id)
      const { narrative: preNormalized, claimIdsStripped, claimCitationUrlsDropped, sectionsWithClaimCitations, claimIdsTruncated } = preNormalizeNarrativeRaw(raw, {
        validUrls: validCitationUrls,
        validNewsIds,
        claimLedger: p.claimLedger ?? [],
      })
      const candidate = { ...p.brief, narrative: preNormalized }
      const parsed = MarketBriefSchema.parse(candidate)
      const narrative = parsed.narrative
      if (!narrative)
        throw new Error('parsed narrative is null')

      // sanitize in-place（recursive cover intro / sections[].body / outro）
      // sanitize 改寫 forbidden 詞可能拉長字串、clamp 一次
      const { sanitized, count } = sanitizeNarrativeForbidden(narrative)
      const clamped = clampNarrativeStringFields(sanitized)
      // sanity re-parse（sanitize+clamp 後仍然合 schema）
      const reCandidate = { ...p.brief, narrative: clamped }
      const reParsed = MarketBriefSchema.parse(reCandidate)

      // 硬 gate：掃 sanitize+clamp 後的 narrative prose、violation → throw → 走既有 catch→retry→degrade
      const violation = checkCompliance(narrativeProseText(clamped))
      if (violation)
        throw new Error(`narrative compliance violation: ${violation.matched}`)

      // 軟警告，不擋 pipeline。掃的是 sanitize+clamp 之後的最終文字——讀者看到的就是
      // 這一版，在 clamp 之前掃會漏掉被截掉的句子。
      const binding = checkNarrativeClaimBinding(clamped, p.claimLedger ?? [])
      warnClaimBindingIssues(binding, claimIdsTruncated)

      // emit final audit signal on the latest LlmCallRecord
      const audit = {
        failed: false,
        retryReason: null,
        fabricationStripped: count,
        claimIdsStripped,
        claimCitationUrlsDropped,
        claimCitationSections: sectionsWithClaimCitations,
        claimUnboundNumbers: binding.unbound,
        claimCheckedNumbers: binding.total,
        claimIdsTruncated,
      }
      emitAudit(p.onCallRecord, audit)

      return {
        narrative: reParsed.narrative ?? null,
        audit,
      }
    }
    catch (err) {
      const reason = classifyError(err)
      const e = err as { message?: string, issues?: unknown }
      // log Zod issues 給 prod debug、攻擊面：narrative 字數 / citation subset / sections 數
      // 不 throw、graceful degrade 流程不變
      console.warn(`[narrative-writer] attempt ${attempt} fail reason=${reason} message=${e.message ?? '(unknown)'}`)
      if (e.issues)
        console.warn(`[narrative-writer] zod issues:`, JSON.stringify(e.issues).slice(0, 800))
      if (attempt === 1)
        firstFailReason = reason
      if (attempt >= MAX_ATTEMPTS) {
        const audit = {
          failed: true,
          retryReason: firstFailReason,
          fabricationStripped: 0,
          claimIdsStripped: 0,
          claimCitationUrlsDropped: 0,
          claimCitationSections: 0,
          claimUnboundNumbers: 0,
          claimCheckedNumbers: 0,
          claimIdsTruncated: 0,
        }
        emitAudit(p.onCallRecord, audit)
        return { narrative: null, audit }
      }
    }
  }
  // unreachable
  return {
    narrative: null,
    audit: { failed: true, retryReason: 'zod-parse', fabricationStripped: 0, claimIdsStripped: 0, claimCitationUrlsDropped: 0, claimCitationSections: 0, claimUnboundNumbers: 0, claimCheckedNumbers: 0, claimIdsTruncated: 0 },
  }
}

function emitAudit(
  onCall: ((r: LlmCallRecord) => void) | undefined,
  audit: CallNarrativeWriterResult['audit'],
) {
  if (!onCall)
    return
  onCall({
    // 這一筆是純 audit signal、不是真的 LLM 呼叫，成本與 token 一律 0（真實用量由
    // callAgentLLM 自己那筆 record 記）。
    agentName: 'narrative-writer',
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    latencyMs: 0,
    attempts: 0,
    narrativeFailed: audit.failed,
    narrativeRetryReason: audit.retryReason,
    narrativeFabricationStripped: audit.fabricationStripped,
    narrativeClaimIdsStripped: audit.claimIdsStripped,
    narrativeClaimCitationUrlsDropped: audit.claimCitationUrlsDropped,
    narrativeClaimCitationSections: audit.claimCitationSections,
    narrativeClaimUnboundNumbers: audit.claimUnboundNumbers,
    narrativeClaimCheckedNumbers: audit.claimCheckedNumbers,
    narrativeClaimIdsTruncated: audit.claimIdsTruncated,
  })
}

// NARRATIVE_REWRITE_MAP / rewriteText 已移到 narrative-shared.ts
// podcast-writer 共用同一份 forbidden 替換表

function sanitizeNarrativeForbidden(n: Narrative): { sanitized: Narrative, count: number } {
  const counter = { count: 0 }
  const sanitized: Narrative = {
    intro: rewriteText(n.intro, counter),
    sections: n.sections.map(s => ({
      ...s,
      heading: rewriteText(s.heading, counter),
      takeaway: s.takeaway === null ? null : rewriteText(s.takeaway, counter),
      body: rewriteText(s.body, counter),
    })),
    outro: rewriteText(n.outro, counter),
  }
  return { sanitized, count: counter.count }
}

// clampString 已移到 narrative-shared.ts (top import)

// export 只為了讓測試驗得到「user content 的脊椎指示措辭」——同一條指示有兩個現場
// （system prompt 與這裡），驗收實測過只改一邊時另一邊會把模板句拉回來。
export function formatUserContent(p: CallNarrativeWriterParams, withLedger: boolean): string {
  const lines: string[] = []
  lines.push(NARRATIVE_WRITER_USER_TEXT.intro(p.briefDate))
  lines.push('')
  if (p.dailyThesis) {
    lines.push(NARRATIVE_WRITER_USER_TEXT.dailyThesisHeading)
    lines.push(p.dailyThesis)
    // 這句與 system prompt 的「# 結構」節是**同一條指示的第二個現場**。system prompt
    // 那邊已禁止段落收尾式宣告（「收束回本日論點」這類），這裡若還寫「outro 收束回它」，
    // 同一次呼叫的兩份指示就互相打架——而 user content 離模型更近。措辭一起換成「用內容承接」。
    lines.push(NARRATIVE_WRITER_USER_TEXT.dailyThesisInstruction)
    lines.push('')
  }
  lines.push(NARRATIVE_WRITER_USER_TEXT.mainThemesHeading)
  if (p.mainThemes && p.mainThemes.length > 0) {
    for (const t of p.mainThemes) lines.push(`- ${t}`)
    lines.push(NARRATIVE_WRITER_USER_TEXT.mainThemesInstructionProvided)
  }
  else {
    lines.push(NARRATIVE_WRITER_USER_TEXT.mainThemesInstructionMissing)
  }
  lines.push('')
  lines.push('## 1. Synthesizer brief')
  lines.push(`headline: ${p.brief.headline}`)
  lines.push(`summary: ${p.brief.summary}`)
  lines.push('')
  if (p.marketCloseFraming) {
    lines.push(p.marketCloseFraming)
    lines.push('')
  }
  if (p.marketSnapshot) {
    lines.push(READER_SNAPSHOT_HEADING)
    lines.push(p.marketSnapshot)
    lines.push('')
  }
  if (p.weeklyRecapBlock) {
    lines.push(p.weeklyRecapBlock)
    lines.push('')
  }
  lines.push(NARRATIVE_WRITER_USER_TEXT.newsSectionHeading(p.analystOutputs.length))
  for (let i = 0; i < p.analystOutputs.length; i++) {
    const a = p.analystOutputs[i]
    if (!a)
      continue
    const news = p.news.find(n => n.id === a.newsId)
    lines.push('')
    lines.push(`### News ${i + 1} (newsId=${a.newsId ?? '(none)'})`)
    if (news) {
      lines.push(`Title: ${news.title}`)
      const label = relativeDayLabel(news.publishedAt, p.briefDate)
      if (label)
        lines.push(NARRATIVE_WRITER_USER_TEXT.publishedLabelLine(label))
      lines.push(`Text excerpt: ${clampString(news.text, 500)}`)
    }
    lines.push(`Primary impact: ${a.primaryImpact}`)
    lines.push(`Reasoning: ${a.reasoning}`)
    if (a.cascadeChains.length > 0) {
      lines.push(`Cascade chains:`)
      for (const c of a.cascadeChains) {
        const tier = c.tier !== undefined ? `tier ${c.tier}` : 'tier ?'
        lines.push(`  - ${tier}: ${c.industry} → ${c.affectedTickers.join(', ')}`)
        lines.push(`    mechanism: ${clampString(c.mechanism, 200)}`)
      }
    }
  }
  lines.push('')
  lines.push(NARRATIVE_WRITER_USER_TEXT.citationsHeading(p.citations.length))
  for (const c of p.citations) {
    lines.push(`  - url: ${c.url}`)
    lines.push(`    title: ${c.title}`)
    lines.push(`    quote: ${clampString(c.quote, 150)}`)
  }
  lines.push('')
  // claim ledger。編號接在 citations（## 3.）之後、行事曆等 block 之前，
  // 位置與「素材」的性質一致（它是本日已核對的證據、不是前瞻參考）。
  if (withLedger) {
    lines.push(NARRATIVE_WRITER_USER_TEXT.claimLedgerHeading(p.claimLedger?.length ?? 0))
    lines.push(formatClaimLedgerBlock(p.claimLedger ?? []))
    lines.push('')
  }
  // 行事曆 block 自帶「## 本週財經行事曆」標頭、wrapper 標題改指示句避免語意重複
  if (p.calendarBlock) {
    lines.push('')
    lines.push(NARRATIVE_WRITER_USER_TEXT.calendarSectionHeading)
    lines.push(p.calendarBlock)
  }
  if (p.storylineBlock) {
    lines.push('')
    lines.push(NARRATIVE_WRITER_USER_TEXT.storylineSectionHeading)
    lines.push(p.storylineBlock)
  }
  if (p.officialBlock) {
    lines.push('')
    lines.push(NARRATIVE_WRITER_USER_TEXT.officialSectionHeading)
    lines.push(p.officialBlock)
  }
  lines.push('')
  lines.push(NARRATIVE_WRITER_USER_TEXT.outputInstruction)
  return lines.join('\n')
}
