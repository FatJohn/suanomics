// toFixed(2) 後去尾零：4.30 → '4.3'、4.00 → '4'。
function trimTrailingZeros(s: string): string {
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s
}

// 千分位整數的兩個 unit：數字與單位間也要半形空白（'23,150 點' vs '4.3%'）。
function usesThousands(unit: string): boolean {
  return unit === '點' || unit === '億元'
}

// 數字部分（不含正負號與單位）。回傳 '0' 同時是「四捨五入後等於零」的判準——
// 點/億元 走 Math.round，差 0.4 點在卡片上就是沒動、不該顯示成 '+0'。
// 呼叫端一律看這個字串判零，不要自己判原始值。
function magnitudeOf(value: number, unit: string): string {
  return usesThousands(unit)
    ? Math.round(Math.abs(value)).toLocaleString('en-US')
    : trimTrailingZeros(Math.abs(value).toFixed(2))
}

// 卡片值格式化：flow 帶正負號、level 僅負值帶號；點/億元 千分位整數、%/元/美元 小數 2 位。
export function formatMarketValue(value: number, unit: string, kind: 'level' | 'flow'): string {
  const magnitude = magnitudeOf(value, unit)
  // magnitude 為 '0' 時不加正負號、避免出現 '-0' / '+0'
  const sign = magnitude === '0'
    ? ''
    : kind === 'flow'
      ? (value >= 0 ? '+' : '-')
      : (value < 0 ? '-' : '')
  const spacer = usesThousands(unit) ? ' ' : ''
  return `${sign}${magnitude}${spacer}${unit}`
}

/**
 * 卡片的變化量（只給數字、單位不重複，值那格已經帶單位了）。無前值回 null。
 *
 * 語意沿用 worker `snapshot.ts` 的 `formatDelta`，只是壓縮成卡片尺寸：
 *
 * - **flow 不給差值、改給前值對照。** flow 的方向取自值本身的正負（見 shared
 *   `computeDirection`），不是與前值的差。今日買超 50、昨日買超 100 時差值是 -50，
 *   但方向仍是買超（紅色▲）——把 -50 放在上漲箭頭旁會被直接讀成「今天賣超 50 億」。
 *   worker 端用「連續買超」這類措辭迴避，卡片沒有那個寬度，改讓讀者自己比前值。
 * - **`%` 序列不做特例**：殖利率值顯示 `4.3%`、delta 顯示 `+0.05` 就是百分點差，
 *   帶上 `%` 反而會被讀成「漲了 0.05%」。
 */
export function formatMarketDelta(
  latest: number,
  previous: number | null,
  unit: string,
  kind: 'level' | 'flow',
): string | null {
  if (previous === null)
    return null
  if (kind === 'flow') {
    const magnitude = magnitudeOf(previous, unit)
    const sign = magnitude === '0' ? '' : previous >= 0 ? '+' : '-'
    return `前 ${sign}${magnitude}`
  }
  const diff = latest - previous
  const magnitude = magnitudeOf(diff, unit)
  // 四捨五入後為零＝卡片上沒動；不能顯示 '+0'，也不該讓 0.4 點看起來像有變化。
  if (magnitude === '0')
    return '持平'
  return `${diff > 0 ? '+' : '-'}${magnitude}`
}
