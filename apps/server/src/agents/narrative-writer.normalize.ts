import type { EvidenceClaim, Narrative } from '@suanomics/shared'
import { truncateAtSentence } from './_truncate.js'
import { clampString, stripControlChars } from './narrative-shared.js'

// 讀者面「一句話結論」：schema 是 nullable、所以不合格的值一律收斂成 null、
// 不讓整份 narrative 因為這一句被 Zod reject（degrade 的粒度是這一句、不是整篇）。
const TAKEAWAY_MAX = 70
const TAKEAWAY_SENTENCE_END = /[。！？」』）]$/

function normalizeTakeaway(v: unknown): string | null {
  if (typeof v !== 'string')
    return null
  const cleaned = stripControlChars(v).trim()
  if (cleaned.length === 0)
    return null
  if (cleaned.length <= TAKEAWAY_MAX)
    return cleaned
  // 超長才截：句中截斷的殘句不該出現在讀者面的粗體結論行、找不到句界就整句 degrade
  const cut = truncateAtSentence(cleaned, TAKEAWAY_MAX)
  return typeof cut === 'string' && TAKEAWAY_SENTENCE_END.test(cut) ? cut : null
}

// 白名單集合。三個欄位型別都是 string[]、用具名物件傳避免呼叫端把順序寫反
// （順序寫反 type-check 擋不住、只會靜默 strip 掉全部）。
export interface NarrativeNormalizeAllowlist {
  validUrls: readonly string[]
  validNewsIds: readonly string[]
  /**
   * 合併去重後的 claim ledger。空陣列 = 當日沒有 ledger、所有 claimIds 都會被 strip。
   * 收整個 claim 而不只是 id 清單，是因為 citationUrls 反推需要 claim 的 `evidenceRefs`；
   * 「id 白名單」與「反推來源」若拆成兩個參數，就有一份給對、另一份給錯的不同步路徑。
   */
  claimLedger: readonly EvidenceClaim[]
}

export interface NarrativeNormalizeResult {
  narrative: unknown
  /**
   * 被 strip 掉的 claimId 數（跨 section 加總）。**只數「ledger 裡沒有」與非字串**——
   * 去重與 max 8 截斷不計入，那兩者是 schema 天花板、不是模型掛了不存在的 claim。
   * 兩者混在一起這個數字就量不出幻覺率。
   */
  claimIdsStripped: number
  /**
   * claim 帶了 citation ref、但 url 不在 `brief.citations[].url` 裡而被丟掉的個數
   * （去重後、跨 section 加總）。**非 0 就是一個要查的訊號**：`convergeRef` 只驗 ref 的形狀、
   * 不驗 url 真的在 citations 裡，所以 claim 帶著無效 url 是可能的。這種 section 會退回
   * 「由模型自己挑」，而不是靜默掛上一個不相干的來源。
   */
  claimCitationUrlsDropped: number
  /** citationUrls 真的由 claim 反推決定的 section 數（traceability ② 的分子）。 */
  sectionsWithClaimCitations: number
  /**
   * **因為 `max 8` 上限而被丟掉**的 claimId 數（去重之後才算，跨 section 加總）。
   *
   * 與 `claimIdsStripped` 是兩件事，不能合併：那個數的是「模型掛了 ledger 裡沒有的 id」
   * ＝幻覺；這個數的是「模型掛對了、但掛太多、被 schema 天花板截掉」＝**我們自己的限制**。
   *
   * 為什麼需要它：2026-08-10 的 prod brief 裡，5 個 section 有 4 個掛滿 8 個上限，而
   * narrative-claim-binding 的 unbound 全部落在掛滿的那些 section（例如 body 用了
   * c10 的 2.43%，c10 確實在 ledger 也有 ref，就是沒掛進那 8 個裡）。當時**沒有任何
   * metric 看得到截斷**，於是無法判斷 unbound 是模型的錯還是上限造成的。
   */
  claimIdsTruncated: number
}

// pre-parse normalize、handle Gemini schema overshoot before Zod validation
// - truncate string：intro/body/outro 走句界截斷（truncateAtSentence）、heading 仍 clampString
// - filter section.citationUrls 移除 unknown、空集 fallback first valid
// - filter relatedNewsIds 到已知 newsId
// - filter claimIds 到 ledger 內的 id（strip 而非整份失敗）
export function preNormalizeNarrativeRaw(raw: unknown, allow: NarrativeNormalizeAllowlist): NarrativeNormalizeResult {
  if (!raw || typeof raw !== 'object')
    return { narrative: raw, claimIdsStripped: 0, claimCitationUrlsDropped: 0, sectionsWithClaimCitations: 0, claimIdsTruncated: 0 }
  const r = raw as Record<string, unknown>
  const out: Record<string, unknown> = { ...r }
  if (typeof r.intro === 'string')
    out.intro = truncateAtSentence(stripControlChars(r.intro), 320, 120)
  if (typeof r.outro === 'string')
    out.outro = truncateAtSentence(stripControlChars(r.outro), 320, 120)
  const validSet = new Set(allow.validUrls)
  const fallbackUrl = allow.validUrls[0]
  const validNewsSet = new Set(allow.validNewsIds)
  const claimById = new Map(allow.claimLedger.map(c => [c.id, c] as const))
  let claimIdsStripped = 0
  let claimCitationUrlsDropped = 0
  let sectionsWithClaimCitations = 0
  let claimIdsTruncated = 0
  if (Array.isArray(r.sections)) {
    out.sections = r.sections.map((s) => {
      if (!s || typeof s !== 'object')
        return s
      const node = s as Record<string, unknown>
      const result: Record<string, unknown> = { ...node }
      if (typeof node.heading === 'string')
        result.heading = clampString(stripControlChars(node.heading), 40)
      if (typeof node.body === 'string')
        result.body = truncateAtSentence(stripControlChars(node.body), 800, 250)
      result.takeaway = normalizeTakeaway(node.takeaway)
      // claimIds 先算：citationUrls 反推吃的是**已經過白名單**的 claimIds
      let sectionClaimIds: string[] = []
      if (Array.isArray(node.claimIds)) {
        const known = node.claimIds.filter((id): id is string => typeof id === 'string' && claimById.has(id))
        claimIdsStripped += node.claimIds.length - known.length
        // 去重**之後**才算截斷：重複的 id 不代表模型想多掛，把它算進 truncated
        // 會讓「上限太緊」看起來比實際嚴重。
        const deduped = Array.from(new Set(known))
        sectionClaimIds = deduped.slice(0, 8)
        claimIdsTruncated += deduped.length - sectionClaimIds.length
        result.claimIds = sectionClaimIds
      }
      if (Array.isArray(node.citationUrls)) {
        // 這一段的出處由它用到的證據決定。反推出的 url **先過白名單再寫入**，
        // 不可倚賴下面那個空集 fallback 兜底——fallback 的語意是「總比沒有好」（為模型挑錯而設），
        // 與「出處由證據決定」衝突時必須是退回讓模型自己挑，而不是被塞一個不相干的來源。
        const refUrls = Array.from(new Set(
          sectionClaimIds.flatMap(id => (claimById.get(id)?.evidenceRefs ?? [])
            .filter(ref => ref.kind === 'citation')
            .map(ref => ref.url)),
        ))
        const validRefUrls = refUrls.filter(u => validSet.has(u))
        claimCitationUrlsDropped += refUrls.length - validRefUrls.length
        if (validRefUrls.length > 0) {
          result.citationUrls = validRefUrls.slice(0, 3)
          sectionsWithClaimCitations++
        }
        else {
          const filtered = node.citationUrls.filter(u => typeof u === 'string' && validSet.has(u))
          const deduped = Array.from(new Set(filtered)).slice(0, 3)
          result.citationUrls = deduped.length > 0 ? deduped : (fallbackUrl !== undefined ? [fallbackUrl] : [])
        }
      }
      if (Array.isArray(node.relatedNewsIds)) {
        result.relatedNewsIds = Array.from(new Set(
          node.relatedNewsIds.filter((id): id is string => typeof id === 'string' && validNewsSet.has(id)),
        )).slice(0, 8)
      }
      return result
    })
  }
  return { narrative: out, claimIdsStripped, claimCitationUrlsDropped, sectionsWithClaimCitations, claimIdsTruncated }
}

export function clampNarrativeStringFields(n: Narrative): Narrative {
  return {
    intro: truncateAtSentence(n.intro, 320, 120) as string,
    sections: n.sections.map(s => ({
      ...s,
      heading: clampString(s.heading, 40),
      body: truncateAtSentence(s.body, 800, 250) as string,
      // sanitize 改寫合規詞可能把 takeaway 撐過 max、再收斂一次（撐爆就 degrade null）
      takeaway: normalizeTakeaway(s.takeaway),
    })),
    outro: truncateAtSentence(n.outro, 320, 120) as string,
  }
}
