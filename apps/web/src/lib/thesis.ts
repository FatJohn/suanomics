export interface ThesisParts { highlight: string, rest: string }

const OPENING = '「『（【《〈'
const CLOSING = '」』）】》〉'

function firstTopLevelCut(text: string): number {
  let depth = 0
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i)
    if (OPENING.includes(ch))
      depth += 1
    else if (CLOSING.includes(ch))
      depth = Math.max(0, depth - 1)
    else if (depth === 0 && (ch === '：' || ch === '。'))
      return i
  }
  return -1
}

/**
 * 主軸切成螢光筆段與其餘墨字：螢光筆只劃到第一個全形冒號或句號之前，一頁只劃一句（DESIGN.md The One Highlighter Rule）。
 * 引號與括號裡的冒號句號不算，螢光筆不會切開一對引號；找不到分句點，或分句點在開頭時整句都劃，
 * 螢光筆不會是空的。兩段接起來一定等於原文。
 */
export function splitThesis(text: string): ThesisParts {
  const cut = firstTopLevelCut(text)
  return cut > 0 ? { highlight: text.slice(0, cut), rest: text.slice(cut) } : { highlight: text, rest: '' }
}
