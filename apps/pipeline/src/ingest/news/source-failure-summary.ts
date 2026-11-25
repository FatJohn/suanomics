import { appendFile } from 'node:fs/promises'

interface SourceResult { slug: string, failed: boolean, error: string | null }

function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ')
}

/** 當天失敗的新聞來源，Actions job summary 用的 Markdown；沒有失敗回空字串。 */
export function renderSourceFailureSummary(results: readonly SourceResult[]): string {
  const failed = results.filter(r => r.failed)
  if (failed.length === 0)
    return ''
  return [
    `## 新聞來源失敗\n\n${failed.length} 個來源本次沒抓到，其餘來源照常處理，run 不因此判失敗。`,
    '',
    '| 來源 | 錯誤 |',
    '|---|---|',
    ...failed.map(r => `| ${r.slug} | ${cell(r.error ?? '未知錯誤')} |`),
    '',
  ].join('\n')
}

/** 寫檔失敗只 warn：單一來源失敗刻意不讓 run 轉紅，報表本身更不該。 */
export async function appendSourceFailureSummary(path: string | undefined, results: readonly SourceResult[]): Promise<void> {
  const markdown = renderSourceFailureSummary(results)
  if (!path || !markdown)
    return
  try {
    await appendFile(path, markdown)
  }
  catch (err) {
    console.warn(JSON.stringify({ event: 'source_failure_summary_failed', message: err instanceof Error ? err.message : String(err) }))
  }
}
