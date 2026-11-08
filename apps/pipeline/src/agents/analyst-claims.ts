import type { EvidenceClaim, EvidenceRef, SeriesAnchor } from '@suanomics/shared'
import type { CitableSeries } from '../market-data/snapshot.js'
import process from 'node:process'
import { autoAttachSeriesRefs, EvidenceClaimSchema, EvidenceRefSchema } from '@suanomics/shared'
import { ANALYST_CLAIMS_USER_TEXT } from '../prompts/analyst-claims.user-content.js'

// analyst-tier1 額外輸出 EvidenceClaim[]，下游先不消費。本檔是那個「額外」的全部——
// flag、prompt 契約、可引用序列區塊、以及把 LLM 的 wire 格式收斂成契約型別的 normalize。

/**
 * 總開關，**預設關閉**。
 *
 * 為什麼要有它：tier1 是 mechanism／primaryImpact 的主寫手，部署啟用每日排程後，
 * 這裡的改動部署上去就會反映進報告，沒有人工複核這一關。
 * 「claim 失敗不影響其他欄位」只保證結構不受影響，
 * 不保證文字品質不回退，而 canary 量不到 prompt 改動。
 * 關閉時 tier1 送給 LLM 的 systemPrompt 與 userContent 逐字與今日相同。
 *
 * 在函式內讀 env（而非 module 載入時）是刻意的：量測腳本要在同一個 process 內跑
 * 開／關兩臂。
 */
export function claimsEnabled(): boolean {
  return process.env.ANALYST_CLAIMS_ENABLED === 'true'
}

/** 防呆上限。遠高於 prompt 要求量（6 chains × 3 = 18），撞到它代表本次產出不可信。 */
const MAX_CLAIMS = 30

// 診斷用計數器：safeParse 淘汰掉幾條 claim。量測報告要出這個數字，
// 而它不屬於 AnalystOutput 契約——claim 被丟掉是**產出品質**的事實，不是分析結果的一部分。
// 模組層計數而非回傳值：唯一的消費者是量測腳本，為它在 callAnalystTier1 一路加參數
// 反而讓 pipeline 帶著一個沒人用的欄位。
let rejectedTotal = 0
export function claimsRejectedTotal(): number {
  return rejectedTotal
}
export function resetClaimsRejectedTotal(): void {
  rejectedTotal = 0
}

// auto-attach 的成效。**沒有這兩個數字，重跑出來的 D1 就讀不出意思**——
// 報告只會說「有 series ref 的 claim 有 N 條」，分不出哪些是模型自己掛的、哪些是機器補的，
// 而這個拆解正是後續決定要靠的依據。
let autoAttachedRefs = 0
let factClaimsGroundedByAutoAttach = 0
let ambiguousNumbersTotal = 0
export function claimsAutoAttachStats(): { refs: number, groundedFactClaims: number, ambiguous: number } {
  return { refs: autoAttachedRefs, groundedFactClaims: factClaimsGroundedByAutoAttach, ambiguous: ambiguousNumbersTotal }
}
export function resetClaimsAutoAttachStats(): void {
  autoAttachedRefs = 0
  factClaimsGroundedByAutoAttach = 0
  ambiguousNumbersTotal = 0
}

/**
 * 可引用序列清單。快照 block 只印 displayName，模型無從得知 seriesId，
 * 於是掛不出合法的 series evidenceRef——D4 會因此大面積失敗，而那是量測工具的失敗、
 * 不是模型的失敗。
 */
export function renderCitableSeriesSection(lines: string[], citableSeries: readonly CitableSeries[]): void {
  if (citableSeries.length === 0)
    return
  lines.push('')
  lines.push(ANALYST_CLAIMS_USER_TEXT.citableSeriesHeading)
  lines.push(ANALYST_CLAIMS_USER_TEXT.citableSeriesRule1)
  lines.push(ANALYST_CLAIMS_USER_TEXT.citableSeriesRule2)
  for (const s of citableSeries)
    lines.push(ANALYST_CLAIMS_USER_TEXT.citableSeriesItem(s.seriesId, s.displayName, s.asOf))
}

/**
 * claim 契約，掛在 tier1 system prompt 之後。
 *
 * 兩份 marker 清單原文列進來，是因為它們就是 D6 的判準——模型看不到就只能猜，
 * 猜錯的後果是 fact 被改判成 inference，而 D1 從此不再要求它有 evidence。
 */
export const CLAIMS_PROMPT_SECTION = ANALYST_CLAIMS_USER_TEXT.claimsPromptSectionLines.join('\n')

/** Gemini 的 JSON Schema 不支援 discriminated union，故 wire 格式攤平、required 只有 kind。 */
export const CLAIMS_GEMINI_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: ['fact', 'inference', 'scenario'] },
      claimType: { type: 'string', enum: ['named-number', 'dated-event', 'causal'] },
      claim: { type: 'string' },
      evidenceRefs: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['citation', 'series'] },
            url: { type: 'string' },
            seriesId: { type: 'string' },
            asOf: { type: 'string' },
          },
          required: ['kind'],
        },
        maxItems: 5,
      },
    },
    required: ['kind', 'claimType', 'claim', 'evidenceRefs'],
  },
}

/**
 * 快照 block 對 monthly 序列印 `2026-05`（`dateLabel` 取 `slice(0,7)`），而可引用清單給
 * `2026-05-01`。模型照抄 block 那一側就會被 `EvidenceRefSchema` 的 `YYYY-MM-DD` 靜默丟掉
 * ——連 D3 都看不到，claim 看起來像沒掛 ref。
 *
 * 這裡只修**形狀**：同一序列、同一個月才 snap 回真實 as-of。給錯月份不 snap，
 * 仍然照樣被判掉——D3 是抓「序列靜默沿用前一交易日」的那道檢查，一個字都不放寬。
 */
function snapMonthlyAsOf(seriesId: unknown, asOf: unknown, anchors: readonly SeriesAnchor[]): unknown {
  if (typeof seriesId !== 'string' || typeof asOf !== 'string' || !/^\d{4}-\d{2}$/.test(asOf))
    return asOf
  const sameMonth = anchors.filter(a => a.seriesId === seriesId && a.asOf.slice(0, 7) === asOf)
  // 同月有兩個錨點（例如最新點與前值同月）時無從判斷模型指哪一個，維持原樣讓 schema 判掉。
  return sameMonth.length === 1 ? sameMonth[0]?.asOf : asOf
}

/** 攤平的 wire ref → 契約型別。組不出合法 ref 就回 null，由呼叫端丟掉**該 ref**。 */
function convergeRef(raw: unknown, anchors: readonly SeriesAnchor[]): EvidenceRef | null {
  if (!raw || typeof raw !== 'object')
    return null
  const r = raw as Record<string, unknown>
  const candidate = r.kind === 'citation'
    ? { kind: 'citation', url: r.url }
    : r.kind === 'series'
      ? { kind: 'series', seriesId: r.seriesId, asOf: snapMonthlyAsOf(r.seriesId, r.asOf, anchors) }
      : null
  if (!candidate)
    return null
  const parsed = EvidenceRefSchema.safeParse(candidate)
  return parsed.success ? parsed.data : null
}

/**
 * LLM 產出 → `EvidenceClaim[]`。
 *
 * **順序是設計的一部分**：`id` 與 `asOf` 在 schema 是必填而 LLM 不產它們，所以必須
 * 先補、再 parse。反過來寫（先 safeParse 再補）會讓每一條 claim 都被丟掉、產出率恆為 0
 * ——而 0% 與「模型真的不產 claim」在報告上長得一模一樣，會被拿去做錯誤決策。
 *
 * 逐 claim safeParse 而非整段 parse：教訓是全有全無的 parse 會讓一個超長欄位
 * 帶走整天的產出。
 */
export function normalizeClaims(raw: unknown, briefDate: string, anchors: readonly SeriesAnchor[]): EvidenceClaim[] {
  if (!Array.isArray(raw))
    return []
  // briefDate 非法時，沒有 series ref 的 claim 全部會在 schema 卡掉、產出率靜默歸零，
  // 而「歸零」與「模型不產 claim」在報告上長得一模一樣。這條 warn 是那個情境的唯一訊號。
  if (!/^\d{4}-\d{2}-\d{2}$/.test(briefDate))
    console.warn(`[analyst-claims] briefDate 格式非法（${briefDate}）、無 series ref 的 claim 將全數被丟棄`)

  const parsed: EvidenceClaim[] = []
  let rejected = 0
  for (const [i, item] of raw.entries()) {
    if (!item || typeof item !== 'object')
      continue
    const node = item as Record<string, unknown>
    const refs = Array.isArray(node.evidenceRefs)
      ? node.evidenceRefs.map(r => convergeRef(r, anchors)).filter((r): r is EvidenceRef => r !== null)
      : []
    // series ref 的 as-of 就是這個 claim 的資料截止日；ISO 日期字串序即時序，可直接比大小。
    const seriesAsOf = refs.filter(r => r.kind === 'series').map(r => r.asOf).sort()
    const result = EvidenceClaimSchema.safeParse({
      kind: node.kind,
      claimType: node.claimType,
      claim: node.claim,
      evidenceRefs: refs,
      asOf: seriesAsOf.at(-1) ?? briefDate,
      // id 這裡只是為了讓 schema 過關的暫時值；存活下來的才在最後統一編號。
      id: `c${i + 1}`,
      // LLM 自報的 checks 一律不採用。pipeline 也不回填——
      // D1–D7（runDeterministicChecks）目前只在離線量測腳本跑，上線的 claim 一律是空陣列。
      // 這不是 TODO，是閾值計畫撤銷後的現況；同一件事在 evidence-ledger.ts 也有記。
      checks: [],
    })
    if (result.success)
      parsed.push(result.data)
    else
      rejected++
  }

  if (rejected > 0) {
    rejectedTotal += rejected
    console.warn(`[analyst-claims] ${rejected} 條 claim 未通過 schema、已丟棄（其餘保留）`)
  }

  const kept = parsed.slice(0, MAX_CLAIMS)
  if (parsed.length > MAX_CLAIMS) {
    console.warn(
      `[analyst-claims] 收到 ${parsed.length} 條合法 claim、超過上限 ${MAX_CLAIMS}、`
      + `已截斷——本次的 claim 產出率數據不可信`,
    )
  }
  // 存活者重新連續編號：`cN` 的形狀讓 D4 對 id 的遮蔽不會誤傷句中的真數字。
  const numbered = kept.map((c, i) => ({ ...c, id: `c${i + 1}` }))

  // auto-attach 排在編號**之後**：它掃句子時要遮掉 claim 自己的 id，遮錯的話
  // `c1` 會咬掉句中真數字的前綴，而編號前的暫時 id 不等於最終 id。
  const attached = autoAttachSeriesRefs(numbered, anchors)
  autoAttachedRefs += attached.attachedRefs
  ambiguousNumbersTotal += attached.ambiguousNumbers
  // 「本來一個 ref 都沒有、被機器補到有」的 **fact** claim 數：D1 的分子裡有多少是機器貢獻的。
  // 限定 fact 是必要的——D1 的分母只有 fact，混入 inference/scenario 會讓扣減過頭。
  for (const [i, before] of numbered.entries()) {
    if (before.kind === 'fact' && before.evidenceRefs.length === 0 && (attached.claims[i]?.evidenceRefs.length ?? 0) > 0)
      factClaimsGroundedByAutoAttach++
  }
  if (attached.ambiguousNumbers > 0) {
    console.warn(
      `[analyst-claims] ${attached.ambiguousNumbers} 個數字同時對上兩個以上具名序列、`
      + `已放棄掛 ref（寧可少掛，也不要造出假的 provenance）`,
    )
  }
  return attached.claims
}
