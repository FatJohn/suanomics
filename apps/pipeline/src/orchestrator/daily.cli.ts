// 每日 pipeline 的進入點：`pnpm --filter pipeline run daily --date YYYY-MM-DD [--force]`。
import process from 'node:process'
import { currentRunId } from '../agents/cost-gate.js'
import { closeDb } from '../db/client.js'
import { getRunUsage } from '../db/repos/llm-calls-repo.js'
import { exitCodeFor, parseDailyArgs } from './daily.cli-args.js'
import { createDailyDeps } from './daily.deps.js'
import { runDaily } from './daily.js'
import { appendRunSummary } from './run-summary.js'

async function main(): Promise<void> {
  const args = parseDailyArgs(process.argv.slice(2))
  const result = await runDaily(args, createDailyDeps())
  console.warn(JSON.stringify({ event: 'result', ...result }))
  process.exitCode = exitCodeFor(result)
}

main()
  .catch((err: unknown) => {
    console.error('[daily] failed:', err)
    process.exitCode = 1
  })
  .finally(async () => {
    await appendRunSummary({ runId: currentRunId(), path: process.env.GITHUB_STEP_SUMMARY, getUsage: getRunUsage })
    await closeDb()
  })
