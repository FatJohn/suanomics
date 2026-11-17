const JUDGES = ['quality', 'continuity'] as const
export type JudgeKind = (typeof JUDGES)[number]

export interface JudgeArgs {
  dates: string[]
  judges: JudgeKind[]
  maxUsd: number
  dryRun: boolean
  out: string
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value)
}

function parseDates(raw: string | undefined): string[] {
  if (raw === undefined)
    throw new Error('--dates 必填，格式 YYYY-MM-DD,YYYY-MM-DD')
  const dates = raw.split(',').map(s => s.trim()).filter(Boolean)
  const bad = dates.find(d => !isCalendarDate(d))
  if (bad !== undefined || dates.length === 0)
    throw new Error(`--dates 的日期必須是 YYYY-MM-DD，收到 ${bad ?? raw}`)
  if (new Set(dates).size !== dates.length)
    throw new Error(`--dates 有重複日期：${raw}`)
  return dates
}

function parseJudges(raw: string | undefined): JudgeKind[] {
  if (raw === undefined || raw === 'all')
    return [...JUDGES]
  const judge = JUDGES.find(j => j === raw)
  if (judge === undefined)
    throw new Error(`--judge 限 ${JUDGES.join('、')} 或 all，收到 ${raw}`)
  return [judge]
}

// 上限另設、不吃 DAILY_COST_LIMIT_USD：judge 不在每日路徑，與當天的報告花費分開算（#33 的決定）。
function parseMaxUsd(raw: string | undefined): number {
  if (raw === undefined)
    return 3
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0)
    throw new Error(`--max-usd 必須是正數，收到 ${raw}`)
  return value
}

export function parseJudgeArgs(argv: readonly string[]): JudgeArgs {
  const values: Record<string, string | undefined> = {}
  let dryRun = false
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--')
      continue
    if (arg === '--dry-run')
      dryRun = true
    else if (arg === '--dates' || arg === '--judge' || arg === '--max-usd' || arg === '--out')
      values[arg] = argv[++i]
    else
      throw new Error(`未知參數：${arg}`)
  }
  return {
    dates: parseDates(values['--dates']),
    judges: parseJudges(values['--judge']),
    maxUsd: parseMaxUsd(values['--max-usd']),
    dryRun,
    out: values['--out'] ?? '.eval-out/judge',
  }
}
