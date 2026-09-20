import type { CheckId, ClaimKind, EvidenceClaim, EvidenceRef } from './evidence-claim.js'
import { containsForbiddenPhrase } from './compliance.js'
import { CONDITIONAL_MARKERS, MARKER_EXCEPTIONS, SPECULATIVE_MARKERS } from './evidence-claim.js'
import { checkDatedEvent, checkNamedNumbers } from './evidence-number-check.js'

// 發佈前稽核的 deterministic 層。順序是設計的一部分：
// 先跑機械檢查、篩掉能機械判定的，只有剩下的因果 claim 才花 LLM。
// 理由不只是成本——LLM 判斷本身需要被信任，能用機械判的就不該交給它。

/**
 * 檢查所需的當日事實。全部由呼叫端注入而非在此 import：
 * SERIES_SPECS 住在 apps/server，shared 不該反向依賴它。
 */
export interface EvidenceContext {
  /** `brief.citations`——D2 比對 url、D5 比對 quote 文字 */
  citations: readonly { url: string, quote: string }[]
  /**
   * 當日快照**實際餵入**的序列點——D3 比對 (seriesId, asOf)、D4 比對 value。
   *
   * 含**前值**點（快照 block 有印、模型真的會引用），各帶自己的 `asOf`；
   * 這不是鄰近日回退，每個 `(seriesId, asOf)` 仍唯一決定一個值。
   *
   * `displayValue` 是 block 實際印出來的數（四捨五入後）。給了它，D4 就同時接受原始值與
   * 顯示值兩個**精確**錨點——否則一個誠實照抄快照的模型必然不及格
   * （費半 `10447.49` 印成 `10,447 點`，差 0.49 遠超容差）。省略時只比對 `value`。
   */
  seriesPoints: readonly { seriesId: string, asOf: string, value: number, displayValue?: number }[]
  /** `SERIES_SPECS` 的 id 集合——用來區分「不是已知序列」與「是已知序列但當天沒進快照」 */
  knownSeriesIds: readonly string[]
  /** 當日 calendar events 的日期——D5 的第三個證據來源 */
  calendarDates: readonly string[]
}

/**
 * 把 MARKER_EXCEPTIONS 遮蔽成等長空白，再拿去比對 marker。
 *
 * 中文沒有詞界，純子字串比對會把「若干」當成「若」、「恐慌／恐怖／恐懼」當成「恐」，
 * 於是一句合法的 fact 被改判 kind。等長替換是為了不動到句中其他位置的比對結果。
 */
function maskMarkerExceptions(sentence: string): string {
  let out = sentence
  for (const ex of MARKER_EXCEPTIONS)
    out = out.replaceAll(ex, ' '.repeat(ex.length))
  return out
}

export interface DroppedRef {
  ref: EvidenceRef
  /** 是哪一條 check 判掉的 */
  check: Extract<CheckId, 'D2' | 'D3'>
  reason: string
}

export interface RefFilterResult {
  kept: EvidenceRef[]
  dropped: DroppedRef[]
}

/**
 * D2 ＋ D3：把掛不上真實證據的 ref 濾掉。
 *
 * 失敗處置是「移除該 ref，再走 D1」，所以本函式只負責移除、不判 claim 生死；
 * 是否還剩證據由 {@link checkFactHasEvidence} 接手。
 */
export function filterValidRefs(refs: readonly EvidenceRef[], ctx: EvidenceContext): RefFilterResult {
  const citationUrls = new Set(ctx.citations.map(c => c.url))
  const knownSeries = new Set(ctx.knownSeriesIds)
  const kept: EvidenceRef[] = []
  const dropped: DroppedRef[] = []

  for (const ref of refs) {
    if (ref.kind === 'citation') {
      if (citationUrls.has(ref.url))
        kept.push(ref)
      else
        dropped.push({ ref, check: 'D2', reason: `url 不在 brief.citations：${ref.url}` })
      continue
    }
    if (!knownSeries.has(ref.seriesId)) {
      dropped.push({ ref, check: 'D3', reason: `未知序列 id：${ref.seriesId}` })
      continue
    }
    // as-of 必須逐字相等、不做鄰近日回退：序列靜默沿用前一交易日正是要抓的失效模式，
    // 放寬成「相近日期」等於把那個 bug 當成合法證據。
    const point = ctx.seriesPoints.find(p => p.seriesId === ref.seriesId && p.asOf === ref.asOf)
    if (point)
      kept.push(ref)
    else
      dropped.push({ ref, check: 'D3', reason: `當日快照沒有 ${ref.seriesId} @ ${ref.asOf}` })
  }
  return { kept, dropped }
}

/**
 * D1：`kind: 'fact'` 必須有 ≥1 個 evidenceRef。
 *
 * 必須在 D2／D3 之後跑——否則一個 ref 全是幻覺 url 的 fact 會因為「陣列非空」而通過。
 * 句子本身怎麼處置（降級／刪句／整份 gate）刻意未定：那取決於實際
 * grounding 率，要等跑真實樣本才知道。
 */
export function checkFactHasEvidence(claim: EvidenceClaim): boolean {
  if (claim.kind !== 'fact')
    return true
  return claim.evidenceRefs.length > 0
}

/**
 * D6：句型與 `kind` 一致。失敗處置是**改判 kind、不刪句**。
 *
 * `inference` 無句型限制（它本來就是推論，兩邊都可以），所以這條檢查只對 `fact`
 * 與 `scenario` 有斷言、對 `inference` 恆通過。
 *
 * 改判去向未明訂，此處的推導寫死如下：
 * - `fact` 帶臆測詞 → 同時帶條件詞就是 `scenario`（「若…則…」是情境），否則 `inference`
 * - `scenario` 不帶條件詞 → 它不是條件句，就不是情境，降為 `inference`
 */
export function reconcileKind(claim: EvidenceClaim): { kind: ClaimKind, changed: boolean } {
  if (claim.kind === 'inference')
    return { kind: 'inference', changed: false }

  const masked = maskMarkerExceptions(claim.claim)
  const conditional = CONDITIONAL_MARKERS.some(m => masked.includes(m))

  if (claim.kind === 'scenario') {
    return conditional
      ? { kind: 'scenario', changed: false }
      : { kind: 'inference', changed: true }
  }
  // kind === 'fact'
  if (!SPECULATIVE_MARKERS.some(m => masked.includes(m)))
    return { kind: 'fact', changed: false }
  return conditional ? { kind: 'scenario', changed: true } : { kind: 'inference', changed: true }
}

/**
 * D7：合規字眼。失敗**沿用既有合規處置**（句級 strip），不是本層的責任，
 * 所以這裡只回報命中了哪個詞。
 *
 * 用的是 `containsForbiddenPhrase`。注意本 repo 另有更嚴的
 * `checkCompliance`（同檔，另含 ticker-direction 判定）——要不要升級到那一層是後續的
 * 決定，這裡不自行擴大。函式名加 Claim 前綴以免與它撞名。
 */
export function checkClaimCompliance(claim: EvidenceClaim): { passed: boolean, phrase?: string } {
  const hit = containsForbiddenPhrase(claim.claim)
  return hit.hit ? { passed: false, ...(hit.phrase ? { phrase: hit.phrase } : {}) } : { passed: true }
}

export interface DeterministicAuditResult {
  /** 套用過 ref 過濾、D4/D5 降級與 D6 改判後的 claim；`checks` 已填好。輸入不被修改。 */
  claim: EvidenceClaim
  /** 跑了**且通過 */
  checks: CheckId[]
  /** 跑了**但沒過 */
  failed: CheckId[]
  /** **沒跑**（不適用：如 causal claim 的 D4、無 series ref 的 D3） */
  skipped: CheckId[]
  /** 人看的說明。三態已由上面三個陣列機械表達，這裡只補「為什麼」 */
  findings: string[]
}

/**
 * 依序跑完 D1–D7。
 *
 * 順序是設計的一部分：D2／D3 先把掛不上證據的 ref 移除，D1 才判得準；
 * D4／D5 只對各自的 claimType 適用；D6 的改判套用在回傳的 claim 上。
 */
export function runDeterministicChecks(claim: EvidenceClaim, ctx: EvidenceContext): DeterministicAuditResult {
  const checks: CheckId[] = []
  const failed: CheckId[] = []
  const skipped: CheckId[] = []
  const findings: string[] = []
  const record = (id: CheckId, applicable: boolean, passed: boolean): void => {
    if (!applicable)
      skipped.push(id)
    else if (passed)
      checks.push(id)
    else failed.push(id)
  }

  const { kept, dropped } = filterValidRefs(claim.evidenceRefs, ctx)
  for (const d of dropped)
    findings.push(`${d.check}：移除 ref——${d.reason}`)
  // 沒有該類 ref 就沒有東西可檢——記成 skipped 而非 passed，否則「無 ref 的 claim」
  // 會拿到一份看起來很乾淨的 checks。
  record('D2', claim.evidenceRefs.some(r => r.kind === 'citation'), !dropped.some(d => d.check === 'D2'))
  record('D3', claim.evidenceRefs.some(r => r.kind === 'series'), !dropped.some(d => d.check === 'D3'))

  const withRefs: EvidenceClaim = { ...claim, evidenceRefs: kept }

  record('D1', claim.kind === 'fact', checkFactHasEvidence(withRefs))
  if (claim.kind === 'fact' && !checkFactHasEvidence(withRefs))
    findings.push('D1：kind=fact 但過濾後沒有任何 evidenceRef')

  // D4／D5 的失敗處置是「不得以 fact 發佈」——所以失敗要真的降下來，
  // 不能只寫進 findings，否則處置等於沒發生。
  let effectiveKind: ClaimKind = withRefs.kind
  const demote = (why: string): void => {
    if (effectiveKind === 'fact') {
      effectiveKind = 'inference'
      findings.push(`${why} → 不得以 fact 發佈，kind 降為 inference`)
    }
  }

  const isNamedNumber = withRefs.claimType === 'named-number'
  const numberResult = isNamedNumber ? checkNamedNumbers(withRefs, ctx) : null
  record('D4', isNamedNumber, numberResult?.passed ?? false)
  if (numberResult && !numberResult.passed) {
    findings.push(`D4：這些數字在 evidence 中找不到——${numberResult.unmatched.map(n => n.raw).join('、')}`)
    demote('D4')
  }

  const isDatedEvent = withRefs.claimType === 'dated-event'
  const dateResult = isDatedEvent ? checkDatedEvent(withRefs, ctx) : null
  record('D5', isDatedEvent, dateResult?.passed ?? false)
  if (dateResult && !dateResult.passed) {
    findings.push(`D5：這些日期在 evidence 中找不到——${dateResult.unmatched.join('、')}`)
    demote('D5')
  }

  // D6 是修正而非拒絕：改判後句型與 kind 就一致了，故計為通過、並在 findings 留下軌跡。
  const { kind, changed } = reconcileKind({ ...withRefs, kind: effectiveKind })
  checks.push('D6')
  if (changed)
    findings.push(`D6：句型與 kind 不符，已由 ${effectiveKind} 改判為 ${kind}`)

  const compliance = checkClaimCompliance(withRefs)
  record('D7', true, compliance.passed)
  if (!compliance.passed)
    findings.push(`D7：命中禁用字眼「${compliance.phrase}」，交既有合規處置`)

  return { claim: { ...withRefs, kind, checks }, checks, failed, skipped, findings }
}
