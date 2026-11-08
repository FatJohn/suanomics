import type { EvidenceClaim, EvidenceRef } from './evidence-claim.js'
import { closeEnough, extractCheckedNumbers } from './evidence-number-check.js'

// 要解的問題：量到 D1 grounding 58.2%，而缺口的 61 條 fact claim **61/61** 都是
// 「引用了快照序列的數字、卻沒掛 series ref」——D2 幻覺 url 與 D3 淘汰數全是 0，一條幻覺都沒有。
// 缺的是一道機械連結，不是證據不存在。強化 prompt 指示已實測無效（series ref 0→1，在雜訊內），
// 所以這裡把問題從「說服模型」換成「用算的」。

/**
 * 一個可被 auto-attach 命中的快照序列點。
 *
 * `displayName` 是**必填**且沒有預設：消歧義完全靠它，缺了就一條都掛不上，
 * 而「一條都掛不上」與「本來就沒東西可掛」在報告上長得一模一樣。
 * 設成必填讓漏傳是 type error，不是靜默歸零。
 */
export interface SeriesAnchor {
  seriesId: string
  displayName: string
  asOf: string
  /** 序列原始值 */
  value: number
  /** 快照 block 實際印出來的值（四捨五入後）。省略時只比對 `value`。 */
  displayValue?: number
}

export interface AutoAttachResult {
  claims: EvidenceClaim[]
  /** 實際補上的 ref 數（去重後） */
  attachedRefs: number
  /** 值與名稱都對上、但同時對上兩個以上序列而**放棄**掛的數字數。0 不代表沒跑，量測報告要一起看。 */
  ambiguousNumbers: number
}

/** 中文句子沒有詞界，`series-config` 寫「美債 10 年期殖利率」而模型寫「美債10年期殖利率」。 */
function stripWhitespace(s: string): string {
  return s.replace(/\s+/g, '')
}

/**
 * 子句切分。**半形逗號與小數點不能切**——否則「10,447」與「4.32」會被切成兩半、數字全毀。
 *
 * 括號與冒號也算分隔：偏保守是刻意的，誤掛會灌水 D1（要拿去做不可逆決定的那個數字），
 * 漏掛只是少算。對 184 條真實 claim 量過，這幾個字元加不加都是 64 個 ref、61/61 回收。
 *
 * **殘留限制（擋不住、已知）**：完全沒有標點、或只用空白分隔的長句
 * （「美債10年期殖利率走升之際台積電毛利率年增4.32%」）仍可能誤掛。試過用「名稱到數字的
 * 字元距離上限」當第二道守衛，但沒有可用門檻——留得住正例的 cap 也會放過誤掛例。
 * 2026-08-05 對真實樣本的 62 個 auto-attach 逐條人工核對，無一誤掛。
 */
const CLAUSE_SEPARATOR = /[，、；。！？：:（）()【】—–\n\t]/

/**
 * 顯示名互相包含時只留最長的（`CPI 年增率` ⊂ `核心 CPI 年增率`）。
 *
 * 不處理的話，一句「核心 CPI 年增率為 3.1%」在 3.1 剛好是一般 CPI 的值時會掛上 `us-cpi-yoy`，
 * 而且**歧義分支救不了**——只有一個序列的值命中，看起來完全不歧義（獨立複查實測）。
 */
function dropContainedNames(named: readonly SeriesAnchor[]): SeriesAnchor[] {
  const stripped = named.map(a => stripWhitespace(a.displayName))
  return named.filter((_, i) =>
    !stripped.some((other, j) => j !== i && other !== stripped[i] && other.includes(stripped[i] ?? '')))
}

function refKey(ref: EvidenceRef): string {
  return ref.kind === 'series' ? `s:${ref.seriesId}@${ref.asOf}` : `c:${ref.url}`
}

/**
 * 在 claim 句中找出「已經寫了快照序列的數字、卻沒掛 series ref」的數字，補上那個 ref。
 *
 * 判定順序（每個數字獨立判、掛得上幾個算幾個）：
 * 1. 該數字若已被現有 **series** ref 背書就跳過——本函式補缺口，不往每條 claim 疊 ref。
 *    刻意不看 citation ref：要判它得先有 `brief.citations` 的 quote 文字，而那是跨新聞
 *    union 出來的、tier1 當下拿不到。硬湊一份會讓 pipeline 與量測餵的 context 不一致
 *    （已經踩過一次）。代價只是「數字同時被某則引用與某個具名序列背書」時
 *    多掛一個 series ref，而那個 ref 本身仍然為真。
 * 2. 候選 ＝ 原始值或顯示值 `closeEnough` 命中的錨點。
 * 3. **數字所在的那個子句（去空白後）必須提到該序列的 displayName**。這條是假 grounding 的
 *    防線：`SERIES_SPECS` 有 13 個序列 unit 是 `%`、值落在 2–5 極常見，純值比對會把
 *    「台積電營收年增 4.32%」誤掛成美債殖利率，而那種誤掛會**灌水 D1**。
 *    範圍限定到子句而非整句，是因為 cascade claim 的常態句型正是「總經序列 ＋ 個股數字」
 *    同句不同子句——「美債10年期殖利率走升之際，台積電毛利率年增 4.32%」整句範圍會誤掛
 *    （獨立複查 2026-08-05 實測）。對 184 條真實 claim 量過代價：掛上的數字 67→64，
 *    而 fact 無 ref 的回收數維持 61/61。
 *    **已知限制**：「…為 10,447 點，前值為 10,910 點」的前值在另一個子句、沒有序列名，
 *    因此不掛（實測 3 個數字）。那些 claim 已由最新值取得 ref，D1 不受影響、只影響 D4。
 * 4. 顯示名互相包含時只留最長的（見 {@link dropContainedNames}）。
 * 5. 以 `(seriesId, asOf)` 去重後恰好剩一個才掛；0 個或 >1 個都放棄。
 *
 * **不改寫 claim 文字、不改 `kind`、不刪 claim、不重算 `asOf`**：`asOf` 是模型自述的資料截止日
 * （由模型自己的 series ref 推得），而這裡補的是機器推導的 provenance，兩者語意不同。
 */
export function autoAttachSeriesRefs(
  claims: readonly EvidenceClaim[],
  anchors: readonly SeriesAnchor[],
): AutoAttachResult {
  let attachedRefs = 0
  let ambiguousNumbers = 0

  const matches = (n: number, a: SeriesAnchor): boolean =>
    closeEnough(n, a.value) || (a.displayValue != null && closeEnough(n, a.displayValue))

  const out = claims.map((claim) => {
    // 已被現有 series ref 背書的數字不再處理。解析用的是同一份錨點，
    // 所以「auto-attach 補了一個 D4 仍然不認的 ref」這種漂移不可能發生。
    const backed = (n: number): boolean => claim.evidenceRefs.some(r =>
      r.kind === 'series'
      && anchors.some(a => a.seriesId === r.seriesId && a.asOf === r.asOf && matches(n, a)))

    const seen = new Set(claim.evidenceRefs.map(refKey))
    const added: EvidenceRef[] = []
    for (const clause of claim.claim.split(CLAUSE_SEPARATOR)) {
      const named = dropContainedNames(
        anchors.filter(a => stripWhitespace(clause).includes(stripWhitespace(a.displayName))),
      )
      if (named.length === 0)
        continue
      for (const n of extractCheckedNumbers(clause, claim.id)) {
        if (backed(n.value))
          continue
        const distinct = [...new Map(named.filter(a => matches(n.value, a)).map(a => [`${a.seriesId}@${a.asOf}`, a])).values()]
        if (distinct.length > 1) {
          ambiguousNumbers++
          continue
        }
        const hit = distinct[0]
        if (!hit)
          continue
        const ref: EvidenceRef = { kind: 'series', seriesId: hit.seriesId, asOf: hit.asOf }
        const key = refKey(ref)
        if (seen.has(key))
          continue
        seen.add(key)
        added.push(ref)
      }
    }

    if (added.length === 0)
      return claim
    attachedRefs += added.length
    return { ...claim, evidenceRefs: [...claim.evidenceRefs, ...added] }
  })

  return { claims: out, attachedRefs, ambiguousNumbers }
}
