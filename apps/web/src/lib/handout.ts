import type { IndustryView } from './present-brief'

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'] as const

// brief 日期是台北的日曆日，用 UTC 解析再取 UTC 星期，避免 build 機器時區把日期推到前一天。
export function weekdayLabel(isoDate: string): string {
  return WEEKDAYS[new Date(`${isoDate}T00:00:00Z`).getUTCDay()] ?? ''
}

const CHARS_PER_MINUTE = 500
const NON_TEXT = /[\s*_`~#>-]/g

export function readingMinutes(texts: readonly string[]): number {
  const chars = texts.join('').replace(NON_TEXT, '').length
  return Math.max(1, Math.ceil(chars / CHARS_PER_MINUTE))
}

const DIRECTION_LABELS: Record<IndustryView['direction'], string> = {
  positive: '正向',
  negative: '負向',
  mixed: '好壞參半',
  uncertain: '不確定',
}

export function directionLabel(direction: IndustryView['direction']): string {
  return DIRECTION_LABELS[direction]
}

const CONFIDENCE_LABELS: Record<IndustryView['confidence'], string> = {
  high: '信心高',
  medium: '信心中',
  low: '信心低',
}

export function confidenceLabel(confidence: IndustryView['confidence']): string {
  return CONFIDENCE_LABELS[confidence]
}

// 「第 N 回」以最早一份為第 1 回；ISO 日期字串排序即時間順序。
export function lectureNumbers(dates: readonly string[]): Map<string, number> {
  return new Map([...dates].sort().map((date, i) => [date, i + 1]))
}

export function groupByMonth<T extends { date: string }>(items: readonly T[]): { month: string, items: T[] }[] {
  const groups: { month: string, items: T[] }[] = []
  for (const item of items) {
    const month = `${item.date.slice(0, 4)} 年 ${Number(item.date.slice(5, 7))} 月`
    const last = groups.at(-1)
    if (last?.month === month)
      last.items.push(item)
    else
      groups.push({ month, items: [item] })
  }
  return groups
}
