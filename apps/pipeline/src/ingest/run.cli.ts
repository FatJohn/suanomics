// 每日 ingest 的進入點。本機驗證：`pnpm --filter @suanomics/pipeline run ingest:run -- --force`。
import process from 'node:process'
import { getDailyCostGate } from '../agents/cost-gate.js'
import { closeDb } from '../db/client.js'
import { getIngestStats } from '../db/repos/ingest-repo.js'
import { runIngest } from './run.js'

async function main(): Promise<void> {
  const startedAt = new Date()
  const result = await runIngest({ force: process.argv.includes('--force') })
  if (result.status === 'skipped') {
    console.warn(`[ingest] ${result.date} 不是交易日，結束`)
    return
  }
  const stats = await getIngestStats(startedAt)
  console.warn(JSON.stringify({
    date: result.date,
    sourcesProcessed: result.news.sourcesProcessed,
    sourcesFailed: result.news.perSource.filter(s => s.failed).map(s => ({ slug: s.slug, httpStatus: s.httpStatus })),
    selected: result.selected,
    failures: result.failures,
    ...stats,
    llmCostUsd: Number(getDailyCostGate().totalUsd.toFixed(4)),
  }, null, 2))
  if (result.failures.length > 0)
    process.exitCode = 1
}

main()
  .catch((err: unknown) => {
    console.error('[ingest] failed:', err)
    process.exitCode = 1
  })
  .finally(() => closeDb())
