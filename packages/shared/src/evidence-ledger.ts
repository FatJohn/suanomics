import type { EvidenceClaim, EvidenceRef } from './evidence-claim.js'
import { normalizeText } from './evidence-number-check.js'

// 合併與去重**刻意是純函式、不是 LLM 工作**：這兩件事完全機械可判，交給 LLM 只會得到
// 不可測、不可重現的結果。「deterministic 先行」在這裡同樣適用。
// 「synthesizer 是 ledger owner」講的是責任歸屬（ledger 掛在那一段產出），不是叫它的 LLM 去合併。

export interface ClaimLedger {
  /** 已去重、已重新編號為 c1..cN；順序＝(來源順序, 來源內順序)，重複者位置由首次出現決定。 */
  claims: EvidenceClaim[]
  /** 併入的來源數。刻意算「傳進來幾個來源」而非「幾個來源有產出」——量測要的是分母。 */
  sourceCount: number
  /** 去重掉幾條。量測用，不進 prompt、不落地。 */
  droppedDuplicates: number
}

// 由弱到強。合併衝突時取 min ＝ 取較保守的說法：一條 claim 只要有任一來源認為它只是
// 推論或情境，ledger 就不該用「事實」的口氣把它交給 narrative。
const KIND_RANK: Record<EvidenceClaim['kind'], number> = { scenario: 0, inference: 1, fact: 2 }

// 去重前的文字正規化。`normalizeText` 是 D4 判定用的同一套（全形數字轉半形、％→%、
// ．→.、－→-、數字間全形逗號轉半形），**刻意共用而不是另寫一份**：兩處若不一致，
// 會出現「D4 說是同一個數字、去重說是兩條 claim」這種很難查的矛盾。
// 尾標點另外去掉——同一句 claim 由不同 analyst 呼叫產出時，句末有無句號純屬隨機。
function normalizeClaimText(s: string): string {
  return normalizeText(s).trim().replace(/[\s。、，,.!?！？]+$/, '')
}

// key 含 claimType：同一句話當成 named-number 與當成 causal 是兩種不同的主張，合併會失真。
// key **不含 asOf**：asOf 取自該次抓到的 series as-of（analyst-claims.ts），
// 同一句 claim 在不同 analyst 呼叫裡可能不同，放進 key 會讓本該合併的兩條分家。
// 用 \u0000 當分隔是因為它不可能出現在 claimType 或 claim 文字裡，不會湊出假的相同 key。
function dedupKey(c: EvidenceClaim): string {
  return `${c.claimType}\u0000${normalizeClaimText(c.claim)}`
}

// 兩種 ref 的判重欄位不同：citation 只看 url；series 看 seriesId + asOf,
// 因為同一條序列的不同 as-of 是兩個不同的證據點，不能壓成一筆。
function refKey(r: EvidenceRef): string {
  return r.kind === 'citation' ? `citation\u0000${r.url}` : `series\u0000${r.seriesId}\u0000${r.asOf}`
}

function mergeClaim(kept: EvidenceClaim, incoming: EvidenceClaim): EvidenceClaim {
  const refs = [...kept.evidenceRefs]
  const seen = new Set(refs.map(refKey))
  for (const r of incoming.evidenceRefs) {
    const k = refKey(r)
    if (!seen.has(k)) {
      seen.add(k)
      refs.push(r)
    }
  }

  return {
    ...kept, // checks 由此帶入＝取第一條，見下方註解
    kind: KIND_RANK[kept.kind] <= KIND_RANK[incoming.kind] ? kept.kind : incoming.kind,
    // 取最新：key 不含 asOf，所以合併進來的可能比較新，那才是這條 claim 真正的資料截止日。
    asOf: kept.asOf >= incoming.asOf ? kept.asOf : incoming.asOf,
    evidenceRefs: refs,
  }
}

/**
 * 把多個來源（實務上是每則新聞一次 analyst 呼叫）的 claim 合併成一份 ledger。
 *
 * 參數刻意是 `EvidenceClaim[][]` 而不是 `AnalystOutput[]`：後者定義在 `apps/server`，
 * 而本套件是被 apps 依賴的那一層、不能反向 import。這也讓本函式與 tier 完全無關——
 * 今天只有 tier1 產 claim，哪天 tier2 也開始產，呼叫端多傳一組進來就涵蓋了。
 *
 * **重新編號是本函式存在的首要理由**：`analyst-claims.ts` 是每則新聞各自從 `c1` 編起，
 * 所以一份 brief 有 N 則新聞就有 N 組 `c1, c2, …`。「brief 內唯一」
 * 是契約意圖、不是現況——那個唯一性要等到有人合併時才建立得起來，就是這裡。
 * 原始 id 不保留：它在 ledger 尺度下沒有意義，留著只會讓人以為可以拿來索引。
 *
 * `checks` 原樣帶過、不做交集也不做聯集。pipeline 產的 claim 一律是 `checks: []`
 * （`analyst-claims.ts`），回填留待之後補上。曾經想寫成「取交集才敢說通過」，
 * 但那在現況下是一條永遠對空陣列運算、測試全綠卻永不生效的死規則。
 * **讀 ledger 的人不得把空的 `checks` 解讀成「所有 check 都沒過」**，它的意思是「還沒有人跑過」。
 */
function refLabel(r: EvidenceRef): string {
  return r.kind === 'citation' ? r.url : `${r.seriesId}@${r.asOf}`
}

/**
 * 把 ledger 排成給 LLM 讀的 markdown block。比照 narrative-writer 既有的
 * `calendarBlock`／`storylineBlock` 慣例：**空的時候回空字串**，由呼叫端據此整段略過，
 * 而不是塞一個「（本日無 claim）」的殼進 prompt。
 *
 * 無 ref 的 claim **照樣列出**並標記「（無）」。它存在但沒有證據，正是 D1 要抓的狀態；
 * 從 block 裡消失會讓 narrative 以為它不存在，也讓事後對照 brief 的人查不到。
 *
 * 參數吃 `EvidenceClaim[]` 而不是 `ClaimLedger`，理由同 `buildClaimLedger`：本函式只用得到
 * claims，`sourceCount`／`droppedDuplicates` 是量測中間值。吃比需要更多的型別會逼呼叫端
 * （例如只拿到 `brief.claimLedger` 那些 claim 的人）去湊一個假的 ledger 物件。
 */
export function formatClaimLedgerBlock(claims: readonly EvidenceClaim[]): string {
  if (claims.length === 0)
    return ''

  return claims.map((c) => {
    const refs = c.evidenceRefs.length > 0 ? c.evidenceRefs.map(refLabel).join('、') : '（無）'
    return `[${c.id}] (${c.kind}/${c.claimType}) ${c.claim} — 來源：${refs}`
  }).join('\n')
}

export function buildClaimLedger(
  perSource: readonly (readonly EvidenceClaim[] | null | undefined)[],
): ClaimLedger {
  // Map 保證插入順序，所以不需要另外維護一個 order 陣列。
  const byKey = new Map<string, EvidenceClaim>()
  let droppedDuplicates = 0

  for (const claims of perSource) {
    // 容忍缺項是刻意的，不是防禦性編程的壞習慣：claim 是**疊加層**（只加欄位、
    // 不改行為），而 `AnalystOutput.claims` 的 `.default([])` 只在走過 Zod parse 時生效。
    // 任何自行組出 AnalystOutput 的呼叫端都會讓這裡拿到 undefined，若因此 throw，
    // 就是讓一個附加功能有權殺掉整份 brief。缺項當成「這個來源沒有 claim」。
    if (claims === null || claims === undefined)
      continue
    for (const c of claims) {
      const key = dedupKey(c)
      const kept = byKey.get(key)
      if (kept === undefined) {
        // 複製陣列欄位：本函式不得改動輸入，而下游會往 evidenceRefs push。
        byKey.set(key, { ...c, evidenceRefs: [...c.evidenceRefs], checks: [...c.checks] })
        continue
      }
      droppedDuplicates++
      byKey.set(key, mergeClaim(kept, c))
    }
  }

  return {
    claims: Array.from(byKey.values()).map((c, i) => ({ ...c, id: `c${i + 1}` })),
    sourceCount: perSource.length,
    droppedDuplicates,
  }
}
