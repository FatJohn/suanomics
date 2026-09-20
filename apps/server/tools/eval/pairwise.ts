// Pairwise judge 的位置偏誤控制核心（quality / continuity judge 共用）。
// 抽自 quality-judge.ts（structural）：兩 orientation 各判甲/乙、映回 A/B、兩次同判才算勝。

export type DimWinner = 'A' | 'B' | 'tie'

// runner 輸出型別：某維度的勝方 + 兩 orientation 的理由。
export interface DimCompareResult { winner: DimWinner, reasons: [string, string] }

// 把單 orientation 的 甲/乙/相當 映回 A/B/tie：firstIsA = 該 orientation 是否把 A 放在「甲」。
export function mapWinner(w: '甲' | '乙' | '相當', firstIsA: boolean): DimWinner {
  if (w === '相當')
    return 'tie'
  const judgePickedFirst = w === '甲'
  return judgePickedFirst === firstIsA ? 'A' : 'B'
}

// 兩 orientation 聚合：兩次同判才算勝、否則（矛盾 / 含 tie / 位置敏感）一律 tie。
export function aggregateDim(o1: DimWinner, o2: DimWinner): DimWinner {
  if (o1 === 'A' && o2 === 'A')
    return 'A'
  if (o1 === 'B' && o2 === 'B')
    return 'B'
  return 'tie'
}
