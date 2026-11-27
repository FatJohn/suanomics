import type { DailyResult } from './daily.js'
import { appendFile } from 'node:fs/promises'

function incompleteExistsText(r: Extract<DailyResult, { reason: 'incomplete-exists' }>): string {
  const stage = r.failedStage ? `（停在 ${r.failedStage}）` : ''
  return `${r.date} 已有 incomplete brief${stage}，本次不補跑；確認當日額度後以 --force 手動重跑。`
}

function lineFor(r: DailyResult): string {
  if (r.status === 'complete')
    return `${r.date} 完成。`
  if (r.status === 'incomplete')
    return `${r.date} 撞到花費上限，停在 ${r.failedStage}，已存成 incomplete。`
  if (r.reason === 'incomplete-exists')
    return incompleteExistsText(r)
  return r.reason === 'already-exists' ? `${r.date} 已有完整報告，略過。` : `${r.date} 非交易日，只抓新聞。`
}

/** Actions job summary 用的 Markdown。 */
export function renderDailySummary(result: DailyResult): string {
  return `## Daily brief\n\n${lineFor(result)}\n`
}

/** 備援遇到 incomplete 時 exit 0，要靠 annotation 讓 run 頁看得到。 */
export function dailyWarning(result: DailyResult): string | undefined {
  if (result.status !== 'skipped' || result.reason !== 'incomplete-exists')
    return undefined
  return `::warning title=Daily brief incomplete::${incompleteExistsText(result)}`
}

/** 摘要失敗只 warn：這時 run 的結果已定，不能讓報表問題改掉 exit code。 */
export async function appendDailySummary(path: string | undefined, text: string): Promise<void> {
  if (!path)
    return
  try {
    await appendFile(path, text)
  }
  catch (err) {
    console.warn(JSON.stringify({ event: 'daily_summary_failed', message: err instanceof Error ? err.message : String(err) }))
  }
}
