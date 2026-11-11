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
// pipeline（analyzer、viewpoints-debate）與網站共用的合規 graceful-strip helper。
export function stripViolatingProse(s: string): string {
  return stripViolatingProseBy(s, text => checkCompliance(text) !== null)
}

// 網站渲染 markdown，要先拿掉標記再檢查，所以判定由呼叫端給。不併成 stripViolatingProse
// 的選填參數：pipeline 有 .map(stripViolatingProse)，index 會被當成第二個參數傳進來。
export function stripViolatingProseBy(s: string, isViolating: (text: string) => boolean): string {
  if (!isViolating(s))
    return s
  const kept = splitSentences(s).filter(sentence => !isViolating(sentence))
  while (kept.length > 0 && isViolating(kept.join('')))
    kept.pop()
  return kept.join('')
}
