// 序列方向的單一真相。
//
// 從 market-key-numbers.ts 抽出來，因為「這條序列在漲還是在跌」不只讀者面的關鍵數字卡
// 要用——跨市場訊號一致性（cross-market-signals.ts）也要，而兩邊各判一次就會漂移：
// flow 序列（買賣超）的方向是值的正負、level 序列是與前值的差，判錯一邊結論就相反。

/** 序列的單一觀測點 */
export interface SeriesPoint { date: string, value: number }

/**
 * `level`：值是存量，方向＝與前值的差。
 * `flow`（如三大法人買賣超）：值本身即買超（+）／賣超（-），方向＝值的正負。
 */
export type SeriesKind = 'level' | 'flow'

export type SeriesDirection = 'up' | 'down' | 'flat'

export function computeSeriesDirection(
  kind: SeriesKind,
  latest: SeriesPoint,
  previous: SeriesPoint | null,
): SeriesDirection {
  const basis = kind === 'flow'
    ? latest.value
    : previous
      ? latest.value - previous.value
      : 0
  if (basis > 0)
    return 'up'
  if (basis < 0)
    return 'down'
  return 'flat'
}
