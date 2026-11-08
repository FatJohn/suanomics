import type { EvidenceClaim, Narrative } from '@suanomics/shared'
import { closeEnough, extractCheckedNumbers } from '@suanomics/shared'

/**
 * 讀者面 narrative 的具名數字，是否真的對得回**該段自己掛的** claim。
 *
 * 與 `ledger-traceability.ts` 的 ①（對整個 ledger 池比對）差在分母的歸屬：
 * 那個指標問「這個數字在 ledger 裡找得到嗎」，這裡問「這個數字是這段宣稱依據的那幾條
 * claim 給的嗎」。2026-08-09 的 prod brief 證明兩者不等價——narrative 用了 `-429`
 * 而該 section 的 `claimIds` 從未掛上任何一條含 -429 的 claim（那三條 claim 全篇沒被
 * 任何 section 引用過），①照樣判 matched 給出 97.6%，而那句話把 8/7 的單日值說成
 * 「全週累積」，與五日加總 +507 億正負號相反。**能對回池子，不代表用對了。**
 *
 * 比對沿用 `extractCheckedNumbers` + `closeEnough`（D4 的同一套）：兩處各寫一套的話，
 * 「D4 說是同一個數字、binding 說不是」會很難查。
 */

export interface UnboundNumber {
  sectionIndex: number
  field: 'heading' | 'body' | 'takeaway'
  value: number
}

export interface NarrativeClaimBindingAudit {
  /** 受檢數字總數（僅 section 內；intro/outro 沒有掛載點、不計入）。 */
  total: number
  /** 其中對不回本段 `claimIds` 的個數。**非 0 就是要查的訊號**。 */
  unbound: number
  /** 逐筆明細——軟警告要能被人追回原文，只給總數查不動。 */
  details: readonly UnboundNumber[]
}

export function checkNarrativeClaimBinding(
  narrative: Narrative,
  claimLedger: readonly EvidenceClaim[],
): NarrativeClaimBindingAudit {
  const claimById = new Map(claimLedger.map(c => [c.id, c] as const))
  const details: UnboundNumber[] = []
  let total = 0

  narrative.sections.forEach((s, sectionIndex) => {
    // 只收本段掛的 claim。掛了不存在的 id 一律當沒掛——那代表模型宣稱的依據不存在，
    // 比「沒宣稱依據」更該被算成 unbound，不能因為 id 長得像就放行。
    const boundNumbers = s.claimIds.flatMap(id =>
      extractCheckedNumbers(claimById.get(id)?.claim ?? '', id).map(n => n.value))

    const fields: ReadonlyArray<readonly [UnboundNumber['field'], string | null]> = [
      ['heading', s.heading],
      ['body', s.body],
      ['takeaway', s.takeaway],
    ]
    for (const [field, text] of fields) {
      if (text === null)
        continue
      for (const n of extractCheckedNumbers(text, '')) {
        total++
        if (!boundNumbers.some(b => closeEnough(n.value, b)))
          details.push({ sectionIndex, field, value: n.value })
      }
    }
  })

  return { total, unbound: details.length, details }
}

/**
 * 軟警告：不擋 pipeline，但要在 worker log 留下**可追回原文**的訊號。
 * `LlmCallRecord` 不落 DB、`brief_json` 也不含 audit，所以 **log 是這些數字唯一的 prod 出口**。
 *
 * 一定要把 `claimIdsTruncated` 一起印：unbound 有兩種成因——模型用了沒宣稱的數字（真問題），
 * 或模型宣稱了但被 `max 8` 上限截掉（我們自己的限制）。兩者在 log 裡分不開就判不動。
 */
export function warnClaimBindingIssues(audit: NarrativeClaimBindingAudit, claimIdsTruncated: number): void {
  if (audit.unbound === 0 && claimIdsTruncated === 0)
    return
  const parts = [`unbound ${audit.unbound}/${audit.total}`]
  if (claimIdsTruncated > 0)
    parts.push(`claimIds 觸上限截掉 ${claimIdsTruncated} 個`)
  if (audit.details.length > 0)
    parts.push(audit.details.map(d => `sec${d.sectionIndex}.${d.field}=${d.value}`).join(' '))
  console.warn(`[narrative-claim-binding] ${parts.join('｜')}`)
}
