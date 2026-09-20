import { appendFile, readFile, writeFile } from 'node:fs/promises'

export interface TrendRow {
  date: string
  tool: string // 'quality' | 'continuity'
  label: string // 'labelA vs labelB'
  verdict: string // script 組好的三維勝負字串
  cost: number
}

export const TREND_TABLE_HEADER
  = '| 日期 | 尺 | 改動 | 三維勝負 | cost($) | 判讀備註 |\n| --- | --- | --- | --- | --- | --- |'

export function formatTrendRow(row: TrendRow): string {
  return `| ${row.date} | ${row.tool} | ${row.label} | ${row.verdict} | ${row.cost.toFixed(4)} |  |`
}

/**
 * append 一行到趨勢日誌；檔不存在則先寫表頭（防呆、正常情況下品質趨勢日誌已存在）。
 */
export async function appendTrendRow(path: string, row: TrendRow): Promise<void> {
  const line = formatTrendRow(row)
  let exists = true
  try {
    await readFile(path, 'utf8')
  }
  catch {
    exists = false
  }
  if (exists)
    await appendFile(path, `${line}\n`, 'utf8')
  else
    await writeFile(path, `${TREND_TABLE_HEADER}\n${line}\n`, 'utf8')
}
