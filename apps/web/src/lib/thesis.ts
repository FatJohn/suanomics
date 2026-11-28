export interface ThesisParts { highlight: string, rest: string }

/**
 * 主軸切成螢光筆段與其餘墨字：螢光筆只劃到第一個全形冒號或句號之前，一頁只劃一句（DESIGN.md The One Highlighter Rule）。
 * 找不到分句點，或分句點在開頭時整句都劃，螢光筆不會是空的；兩段接起來一定等於原文。
 */
export function splitThesis(text: string): ThesisParts {
  const cut = text.search(/[：。]/)
  return cut > 0 ? { highlight: text.slice(0, cut), rest: text.slice(cut) } : { highlight: text, rest: '' }
}
