import type { DailyResult } from './daily.js'

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value)
}

export function parseDailyArgs(argv: readonly string[]): { date: string, force: boolean } {
  let date: string | undefined
  let force = false
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--')
      continue
    if (arg === '--force')
      force = true
    else if (arg === '--date')
      date = argv[++i]
    else
      throw new Error(`未知參數：${arg}`)
  }
  if (date === undefined || !isCalendarDate(date))
    throw new Error(`--date 必須是 YYYY-MM-DD，收到 ${date ?? '（未提供）'}`)
  return { date, force }
}

export function exitCodeFor(result: DailyResult): number {
  return result.status === 'incomplete' ? 1 : 0
}
