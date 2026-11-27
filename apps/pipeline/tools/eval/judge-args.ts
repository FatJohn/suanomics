const JUDGES = ['quality', 'continuity'] as const
export type JudgeKind = (typeof JUDGES)[number]

export interface JudgeArgs {
  dates: string[]
  judges: JudgeKind[]
  maxUsd: number
  dryRun: boolean
  out: string
  // 排程自動跑用：沒有 brief 的日子（非交易日、花費閘中止）跳過而非失敗；
  // 已評過的 judge 不重跑（備援 run 以 already-exists 成功時也會觸發 judge）。
  skipMissing: boolean
  skipJudged: boolean
  // 評 shadow_briefs 的 no-corpus 影子報告（#34 A/B），不評正式報告。
  shadow: boolean
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

// judge 自己的上限，不吃 DAILY_COST_LIMIT_USD；但與每日路徑共用 DAILY_TOTAL_COST_LIMIT_USD 的當日總額（#131 的決定，取代 #33 的分開算）。
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
  const flags = new Set<string>()
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--')
      continue
    if (arg === '--dry-run' || arg === '--skip-missing' || arg === '--skip-judged' || arg === '--shadow')
      flags.add(arg)
    else if (arg === '--dates' || arg === '--judge' || arg === '--max-usd' || arg === '--out')
      values[arg] = argv[++i]
    else
      throw new Error(`未知參數：${arg}`)
  }
  const shadow = flags.has('--shadow')
  if (shadow && (flags.has('--skip-missing') || flags.has('--skip-judged')))
    throw new Error('--shadow 不與 --skip-missing、--skip-judged 並用：已評判斷看的是正式報告的帳')
  // continuity 比的是前幾日的正式報告，拿來評影子報告比不出 corpus 的差異。
  if (shadow && values['--judge'] === 'continuity')
    throw new Error('--shadow 只評 quality')
  return {
    dates: parseDates(values['--dates']),
    judges: shadow ? ['quality'] : parseJudges(values['--judge']),
    maxUsd: parseMaxUsd(values['--max-usd']),
    dryRun: flags.has('--dry-run'),
    out: values['--out'] ?? '.eval-out/judge',
    skipMissing: flags.has('--skip-missing'),
    skipJudged: flags.has('--skip-judged'),
    shadow,
  }
}
