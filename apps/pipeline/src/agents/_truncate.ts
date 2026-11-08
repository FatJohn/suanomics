// Shared hard-cut truncation：撞 max 時切到 max-1 並補 '…'（省 1 字保語意連續）。
// 讀者面 prose 請改用 truncateAtSentence（句界截斷、不補「…」）；本函式用於 title /
// heading / prompt-input 素材那類「硬切無妨」的欄位。
export function clampString(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`
}

// clampString 的 unknown-safe 包裝：Gemini schema-overflow 防禦、非 string 直接 pass-through。
export function truncateString(s: unknown, max: number): string | unknown {
  return typeof s === 'string' ? clampString(s, max) : s
}

// 讀者面 prose 句界截斷：取代 hard-cut（slice+「…」）。
// 截到 max 內最後一個完整句（。！？ 或其後緊跟的收尾符號）、不補符號。
// 找不到句界、或句界早於 minLen → fallback 硬切到 max（length ≤ max ≥ min、不 throw）。
const SENTENCE_ENDERS = new Set(['。', '！', '？'])
const TRAILING_CLOSERS = new Set(['」', '』', '）', '"'])

export function truncateAtSentence(s: unknown, max: number, minLen = 0): string | unknown {
  if (typeof s !== 'string')
    return s
  if (s.length <= max)
    return s
  let end = -1
  for (let i = max - 1; i >= 0; i--) {
    const ch = s[i]
    if (ch !== undefined && SENTENCE_ENDERS.has(ch)) {
      end = i
      break
    }
  }
  if (end >= 0) {
    let j = end
    while (j + 1 < max) {
      const next = s[j + 1]
      if (next === undefined || !TRAILING_CLOSERS.has(next))
        break
      j++
    }
    const cut = j + 1
    if (cut >= minLen)
      return s.slice(0, cut)
  }
  return s.slice(0, max)
}

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
