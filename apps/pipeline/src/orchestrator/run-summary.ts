import type { RunUsage } from '../db/repos/llm-calls-repo.js'
import { appendFile } from 'node:fs/promises'
import { renderRunSummary } from '../agents/llm-usage-format.js'

/** 摘要失敗只 warn：這時 run 的結果已定，不能讓報表問題改掉 exit code。 */
export async function appendRunSummary(p: { runId: string, path: string | undefined, getUsage: (runId: string) => Promise<RunUsage> }): Promise<void> {
  if (!p.path)
    return
  try {
    await appendFile(p.path, renderRunSummary(p.runId, await p.getUsage(p.runId)))
  }
  catch (err) {
    console.warn(JSON.stringify({ event: 'run_summary_failed', message: err instanceof Error ? err.message : String(err) }))
  }
}
