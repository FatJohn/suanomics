import type { DailyUsage, RunUsage } from '../db/repos/llm-calls-repo.js'

function usd(value: number): string {
  return `$${value.toFixed(4)}`
}

/** Actions job summary 用的 Markdown。 */
export function renderRunSummary(runId: string, usage: RunUsage): string {
  const header = `## LLM 用量\n\nrun \`${runId}\``
  if (usage.calls === 0)
    return `${header}：本次沒有 LLM 呼叫。\n`
  const rows = usage.byAgent.map(a => `| ${a.agent} | ${a.calls} | ${a.failed} | ${a.retries} | ${usd(a.usd)} |`)
  return [
    `${header}：總額 ${usd(usage.totalUsd)}，呼叫 ${usage.calls} 次（失敗 ${usage.failed}、重試 ${usage.retries}）`,
    ...(usage.failed > 0 ? ['', '沒有回傳 usage 的失敗呼叫金額未知，未計入總額。'] : []),
    '',
    '| agent | 呼叫 | 失敗 | 重試 | 花費 |',
    '|---|---|---|---|---|',
    ...rows,
    '',
  ].join('\n')
}

export function renderDailyUsage(days: DailyUsage[]): string {
  if (days.length === 0)
    return '指定區間沒有資料'
  return days.flatMap(d => [
    `${d.day}  ${usd(d.totalUsd)}  calls=${d.calls}  failed=${d.failed}`,
    ...d.byAgent.map(a => `  agent ${a.agent}  ${usd(a.usd)}  calls=${a.calls}`),
    ...d.byModel.map(m => `  model ${m.model}  ${usd(m.usd)}  calls=${m.calls}`),
  ]).join('\n')
}
