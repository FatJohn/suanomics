import type { EvidenceClaim, EvidenceContext, MarketBrief } from '@suanomics/shared'
import { closeEnough, extractCheckedNumbers, runDeterministicChecks } from '@suanomics/shared'

/**
 * traceability ①：讀者面的具名數字裡，有多少能對回一條 ledger claim。
 *
 * **只用數值比對、不用字串包含**：`includes('23150')` 會在「231500」裡命中，
 * 而讀者面與 claim 兩邊的寫法（千分位、全形）本來就不保證一致。分子分母都靠
 * `extractCheckedNumbers` 抽 token 再用 `closeEnough` 比值——那是 D4 判定用的同一套，
 * 兩處若各寫一套，「D4 說是同一個數字、traceability 說不是」會很難查。
 *
 * 分母**不含**年份與曆日（`extractCheckedNumbers` 的排除清單已處理）：把「2026 年」
 * 算成一個對不到 ledger 的數字，會系統性壓低這個比例，而那正是要拿去做決定的數字。
 */
export type ReaderSurface = 'headline' | 'summary' | 'reasoningChain' | 'narrative'

export interface SurfaceCount {
  total: number
  matched: number
}

export interface TraceabilityMetrics {
  bySurface: Record<ReaderSurface, SurfaceCount>
  totals: SurfaceCount
  /**
   * viewpoints（支持點／挑戰點／綜合淨讀）的追溯率。
   *
   * **刻意不併進 `bySurface`／`totals`**：`totals` 是 `bySurface` 的總和，把新面加進去
   * 會改動分母、讓 2026-08 之前的追溯率基線（~95.5%）失去可比性。要看整體就自己加，
   * 但兩個數字的歷史長度不同，別混成一條趨勢線。
   *
   * 為什麼現在才加：viewpoints 一直是讀者面，但數字很稀疏；把 claimLedger 餵進辯論 agent
   * 後，riskPoints 帶具名數字的比例由 40% 升到 68%，它才變成一個值得單獨追蹤的面。
   * 2026-08-14 對接上 claimLedger **之前**的四份 prod brief 粗估，
   * 這一面只有 50–60%（narrative 是 ~95.5%），且查不到的幾乎都是挑戰主軸的反向數字
   * ——ledger 本身偏向支持側。
   */
  viewpoints: SurfaceCount
  /** ledger 內的 claim 總數（旗標關閉那一臂仍可能有 ledger，它只是沒進 prompt）。 */
  ledgerClaims: number
  /** `kind: 'fact'` 的 claim 數（閾值的分母）。 */
  factClaims: number
  /** 其中 `evidenceRefs` 為空的——「這條事實沒有任何依據」的可稽核狀態。 */
  unsupportedFactClaims: number
}

/**
 * D2／D3 的數字（有一個可推翻條件：若日後 D2／D3 開始出現非 0 的
 * 淘汰數，(c) 的論證要重來——所以這兩個數字必須明確回報，不能只報 D1／D4）。
 *
 * - **D2**：claim 的 citation ref，url 真的在 `brief.citations` 裡。
 * - **D3**：claim 的 series ref，`(seriesId, asOf)` 真的在當日快照裡。
 *
 * 「不適用」（沒有該類 ref）與「跑了沒過」是兩件事，分開記——把不適用算成通過，
 * 一個完全沒有 ref 的 claim 會拿到一份看起來很乾淨的成績單。
 */
export interface RefCheckCounts {
  d2Applicable: number
  d2Passed: number
  d3Applicable: number
  d3Passed: number
  /** 被 D2／D3 濾掉的 ref 數（不是 claim 數：一條 claim 可以掉多個 ref）。 */
  refsDroppedD2: number
  refsDroppedD3: number
}

export function measureRefChecks(claims: readonly EvidenceClaim[], ctx: EvidenceContext): RefCheckCounts {
  const out: RefCheckCounts = {
    d2Applicable: 0,
    d2Passed: 0,
    d3Applicable: 0,
    d3Passed: 0,
    refsDroppedD2: 0,
    refsDroppedD3: 0,
  }
  for (const c of claims) {
    const audit = runDeterministicChecks(c, ctx)
    if (audit.checks.includes('D2')) {
      out.d2Applicable++
      out.d2Passed++
    }
    else if (audit.failed.includes('D2')) {
      out.d2Applicable++
    }
    if (audit.checks.includes('D3')) {
      out.d3Applicable++
      out.d3Passed++
    }
    else if (audit.failed.includes('D3')) {
      out.d3Applicable++
    }
    for (const f of audit.findings) {
      if (f.startsWith('D2：'))
        out.refsDroppedD2++
      else if (f.startsWith('D3：'))
        out.refsDroppedD3++
    }
  }
  return out
}

function numbersIn(text: string): number[] {
  return extractCheckedNumbers(text, '').map(n => n.value)
}

function countSurface(texts: readonly string[], ledgerNumbers: readonly number[]): SurfaceCount {
  let total = 0
  let matched = 0
  for (const t of texts) {
    for (const v of numbersIn(t)) {
      total++
      if (ledgerNumbers.some(l => closeEnough(v, l)))
        matched++
    }
  }
  return { total, matched }
}

function narrativeTexts(brief: MarketBrief): string[] {
  const n = brief.narrative
  if (!n)
    return []
  const out = [n.intro, n.outro]
  for (const s of n.sections) {
    out.push(s.heading, s.body)
    if (s.takeaway !== null)
      out.push(s.takeaway)
  }
  return out
}

export function measureTraceability(brief: MarketBrief): TraceabilityMetrics {
  const ledger: readonly EvidenceClaim[] = brief.claimLedger ?? []
  const ledgerNumbers = ledger.flatMap(c => extractCheckedNumbers(c.claim, c.id).map(n => n.value))

  const bySurface: Record<ReaderSurface, SurfaceCount> = {
    headline: countSurface([brief.headline], ledgerNumbers),
    summary: countSurface([brief.summary], ledgerNumbers),
    reasoningChain: countSurface(brief.reasoningChain, ledgerNumbers),
    narrative: countSurface(narrativeTexts(brief), ledgerNumbers),
  }
  const totals = Object.values(bySurface).reduce<SurfaceCount>(
    (acc, s) => ({ total: acc.total + s.total, matched: acc.matched + s.matched }),
    { total: 0, matched: 0 },
  )

  const vp = brief.viewpoints
  const viewpoints = countSurface(
    vp ? [...vp.supportPoints, ...vp.riskPoints, vp.netRead] : [],
    ledgerNumbers,
  )

  const facts = ledger.filter(c => c.kind === 'fact')
  return {
    bySurface,
    totals,
    viewpoints,
    ledgerClaims: ledger.length,
    factClaims: facts.length,
    unsupportedFactClaims: facts.filter(c => c.evidenceRefs.length === 0).length,
  }
}
