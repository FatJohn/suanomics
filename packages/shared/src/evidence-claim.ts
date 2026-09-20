import { z } from 'zod'

// EvidenceClaim 契約。
// 生命週期是一份 brief：claim 不互相連結、不建實體關係、不跨日累積成圖。

export const ClaimKindSchema = z.enum(['fact', 'inference', 'scenario'])
export type ClaimKind = z.infer<typeof ClaimKindSchema>

export const ClaimTypeSchema = z.enum(['named-number', 'dated-event', 'causal'])
export type ClaimType = z.infer<typeof ClaimTypeSchema>

export const CheckIdSchema = z.enum(['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7'])
export type CheckId = z.infer<typeof CheckIdSchema>

// 兩種 ref 的 deterministic 檢查方式完全不同：citation 比對 brief.citations 的 url
// 與 quote 文字，series 比對當日快照的 (seriesId, asOf) 數值。混成一個字串陣列就檢查不了——
// 市場序列的數字今天掛不上任何 citation URL（SeriesSpec 沒有來源 URL 欄位）。
export const EvidenceRefSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('citation'),
    url: z.string().url(),
  }),
  z.object({
    kind: z.literal('series'),
    seriesId: z.string().min(1),
    asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
])
export type EvidenceRef = z.infer<typeof EvidenceRefSchema>

export const EvidenceClaimSchema = z.object({
  // brief 內唯一；跨 brief 不保證穩定（不做知識圖譜）
  id: z.string().min(1),
  kind: ClaimKindSchema,
  claimType: ClaimTypeSchema,
  // 單句、可證偽
  claim: z.string().min(1),
  // 空陣列合法：「fact 必須有 evidence」是 D1 的判定，不是 schema 的事。
  // schema 擋掉會讓 gate 失去「這個 claim 存在但沒證據」這個可稽核的狀態。
  evidenceRefs: z.array(EvidenceRefSchema).default([]),
  // 這個 claim 的資料截止日，不是報告日
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  // 通過了哪幾條 deterministic check。取代原本的 confidence：
  // confidence 若是 D1–D7 結果的純函數就不帶新資訊，而且有損——
  // 「D4 通過但 D5 沒跑」與「D4 只有 normalized match」會壓成同一個數字。
  // LLM 自報的 confidence 一律不採用、不得進任何 gate，故契約裡不存在該欄位。
  checks: z.array(CheckIdSchema).default([]),
})
export type EvidenceClaim = z.infer<typeof EvidenceClaimSchema>

// 以下三個清單都是**窮舉的**、落在 code 的常數，不是舉例。
// 新增詞要改常數並補測試——它們是稽核規則本身，不該由呼叫端在執行期改動。

/** `fact` 不得出現其中任一詞。 */
export const SPECULATIVE_MARKERS: readonly string[] = Object.freeze([
  '可能',
  '預期',
  '恐',
  '若',
  '料將',
  '估計',
  '有望',
  '不排除',
  '研判',
])

/** `scenario` 必須出現其中至少一詞。 */
export const CONDITIONAL_MARKERS: readonly string[] = Object.freeze([
  '若',
  '一旦',
  '假設',
  '倘',
  '前提是',
])

// 中文沒有詞界，純子字串比對會把「若干」當成「若」、「恐慌／恐怖／恐懼」當成「恐」，
// 於是一句合法的 fact 被改判 kind。比對 marker 前先把這些例外遮蔽成佔位符。
//
// 為什麼誤判要當真問題處理：fact 被誤降級成 inference 之後，D1 就不再要求它有 evidence
// ——稽核力道會在沒人察覺的情況下被削弱。所以寧可把例外清單列長一點。
export const MARKER_EXCEPTIONS: readonly string[] = Object.freeze([
  '若干',
  '恐慌',
  '恐怖',
  '恐懼',
  // 以下四個是 2026-08-05 驗收實測出來的誤判：它們都含 marker 但語意不是臆測
  '不可能', //   含「可能」，是斷言不是臆測
  '預期心理', // 含「預期」，是名詞
  '符合預期', // 含「預期」，陳述已發生的事
  '估計值', //   含「估計」，是名詞
])
