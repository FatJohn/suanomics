import type { EvidenceClaim } from '@suanomics/shared'
import { closeEnough, extractCheckedNumbers, normalizeText } from '@suanomics/shared'

/**
 * viewpoints A/B 的覆蓋率量尺。
 *
 * 為什麼不直接用 `extractCheckedNumbers`：它已經套好「修辭數字排除、中文負號、全形轉半形」
 * 這些規則，但**不看單位**——`30%` 與 `30萬顆` 都抽成 `30`。2026-08-12 的第一版 A/B 就因此
 * 把 no-ledger 臂記成命中 c9（印能科技產能 +30%），而該臂文字裡「印能」出現 0 次。
 *
 * 所以這裡不改 shared 的抽取器（它是 binding gate 的量尺，動它會連帶影響 D4 基線的可比性），
 * 改成拿它的輸出當**白名單**、再自己掃一次帶單位的 token，把倍率吃進數值裡。
 */

const SCALE: Record<string, number> = { 萬: 1e4, 億: 1e8, 兆: 1e12 }

/** 數字 ＋ 選配倍率 ＋ 選配百分號；lookbehind 與 shared 的 NUMBER_RE 一致 */
const SCALED_RE = /(?<![\d.,])(-?\d[\d,]*(?:\.\d+)?)\s*([萬億兆])?\s*([%％])?/g

export interface ScaledNumber {
  /** 已把 萬/億/兆 乘進去的值 */
  value: number
  /** `%` 或空字串；倍率不算單位（它已折進 value） */
  unit: string
}

export function extractScaledNumbers(text: string, claimId: string): ScaledNumber[] {
  // 白名單：只認既有規則收下的數字，修辭數字（版本號、季別、`N 年期`）照樣被排除
  const accepted = extractCheckedNumbers(text, claimId)
  if (accepted.length === 0)
    return []

  const out: ScaledNumber[] = []
  for (const m of normalizeText(text).matchAll(SCALED_RE)) {
    const base = Number((m[1] ?? '').replace(/,/g, ''))
    if (!Number.isFinite(base))
      continue
    if (!accepted.some(a => closeEnough(a.value, base)))
      continue
    const scaleChar = m[2]
    out.push({
      value: base * (scaleChar ? (SCALE[scaleChar] ?? 1) : 1),
      unit: m[3] ? '%' : '',
    })
  }
  return out
}

/**
 * 這條 claim 的受檢數字，有沒有以**相同數值與相同單位**出現在 text 裡。
 * 沒有受檢數字的 claim 一律回 false——對它們這個量法無效，不該算進分子也不該算進分母
 * （分母由呼叫端用 `claimIsEligible` 判）。
 */
export function claimSurfacedIn(claim: EvidenceClaim, text: string): boolean {
  const want = extractScaledNumbers(claim.claim, claim.id)
  if (want.length === 0)
    return false
  const got = extractScaledNumbers(text, '')
  return want.some(w => got.some(g => g.unit === w.unit && closeEnough(g.value, w.value)))
}

export function claimIsEligible(claim: EvidenceClaim): boolean {
  return extractScaledNumbers(claim.claim, claim.id).length > 0
}
