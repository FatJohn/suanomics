// corpus 背景庫的 refresh 進入點：抓 external_sources 的來源、enrich 後寫進 external_articles。
// 本機驗證：`pnpm --filter @suanomics/pipeline run corpus:refresh -- --source fsc-news`。
import process from 'node:process'
import { installSharedDailyCostGate } from '../agents/daily-budget.js'
import { closeDb } from '../db/client.js'
import { exitCodeFor, parseCorpusRefreshArgs } from './corpus-refresh.args.js'
import { runCorpusRefresh } from './corpus-worker.js'

async function main(): Promise<void> {
  const payload = parseCorpusRefreshArgs(process.argv.slice(2))
  // 先建閘：沒設 DAILY_COST_LIMIT_USD 或 DAILY_TOTAL_COST_LIMIT_USD 時在抓任何東西之前就失敗，而不是跑完才在印摘要時炸掉。
  const gate = await installSharedDailyCostGate()
  const result = await runCorpusRefresh({ payload })
  for (const slug of result.failedSources)
    console.warn(`::warning title=corpus 來源抓取失敗::${slug}`)
  console.warn(JSON.stringify({
    ...result,
    llmCostUsd: Number(gate.totalUsd.toFixed(4)),
  }, null, 2))
  process.exitCode = exitCodeFor(result)
}

main()
  .catch((err: unknown) => {
    console.error('[corpus-refresh] failed:', err)
    process.exitCode = 1
  })
  .finally(() => closeDb())
