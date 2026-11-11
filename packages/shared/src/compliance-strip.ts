import { checkCompliance } from './compliance.js'

// 讀者面 prose 句界切分：以 。！？!? 與換行為界、分隔符留在該句尾。
// 供 compliance graceful-strip 用（移除單一違規句、保留其餘）。
export function splitSentences(s: string): string[] {
  const out: string[] = []
  let cur = ''
  for (const ch of s) {
    cur += ch
    if (ch === '。' || ch === '！' || ch === '？' || ch === '!' || ch === '?' || ch === '\n') {
      out.push(cur)
      cur = ''
    }
  }
  if (cur.length > 0)
    out.push(cur)
  return out
}

// 移除 prose 中的違規句、保留其餘；clean 字串原樣回傳。
// 先濾掉「自身獨立即違規」的句子；再處理跨句 proximity 殘留
// （如 ticker 與 bare 方向詞分屬相鄰兩句、合起來才命中）：從尾端逐句丟棄直到整體 clean。
// analyzer（brief 讀者面）與 viewpoints-debate（正反觀點）共用的合規 graceful-strip helper。
export function stripViolatingProse(s: string): string {
  if (checkCompliance(s) === null)
    return s
  const kept = splitSentences(s).filter(sentence => checkCompliance(sentence) === null)
  while (kept.length > 0 && checkCompliance(kept.join('')) !== null)
    kept.pop()
  return kept.join('')
}
