export interface RawPoint { date: string, value: number } // date: 'YYYY-MM-DD'

// yoy 的「12 個月前」以 (year-1, 同月) 比對、日取該月任一筆（FRED 月頻固定每月 1 日）。
// 之所以用「同月對照」而非「往回數 12 個現有點」：FRED 月頻可能缺月、
// 數點會錯位、用 year-month key 才能保證拿到真正去年同月的基準值。
function monthKey(date: string): string {
  return date.slice(0, 7)
}

function shiftYearKey(date: string): string {
  const y = Number(date.slice(0, 4)) - 1
  return `${y}${date.slice(4, 7)}`
}

export function applyTransform(kind: 'level' | 'yoy' | 'mom-diff', points: RawPoint[]): RawPoint[] {
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date))
  if (kind === 'level')
    return sorted
  if (kind === 'yoy') {
    const byMonth = new Map(sorted.map(p => [monthKey(p.date), p.value]))
    return sorted.flatMap((p) => {
      const prev = byMonth.get(shiftYearKey(p.date))
      // prev === 0 也跳過：避免除以零產生 Infinity/NaN。
      return prev === undefined || prev === 0 ? [] : [{ date: p.date, value: (p.value / prev - 1) * 100 }]
    })
  }
  // mom-diff
  return sorted.flatMap((p, i) => {
    const prev = sorted[i - 1]
    return prev ? [{ date: p.date, value: p.value - prev.value }] : []
  })
}

export function applySpread(a: RawPoint[], b: RawPoint[]): RawPoint[] {
  const bByDate = new Map(b.map(p => [p.date, p.value]))
  return [...a]
    .sort((x, y) => x.date.localeCompare(y.date))
    .flatMap((p) => {
      const bv = bByDate.get(p.date)
      return bv === undefined ? [] : [{ date: p.date, value: p.value - bv }]
    })
}
