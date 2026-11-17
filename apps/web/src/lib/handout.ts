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
