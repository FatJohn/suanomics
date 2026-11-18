// corpus 背景庫的 refresh 進入點：抓 external_sources 的來源、enrich 後寫進 external_articles。
// 本機驗證：`pnpm --filter @suanomics/pipeline run corpus:refresh -- --source fsc-news`。
import process from 'node:process'
import { getDailyCostGate } from '../agents/cost-gate.js'
import { closeDb } from '../db/client.js'
import { exitCodeFor, parseCorpusRefreshArgs } from './corpus-refresh.args.js'
import { runCorpusRefresh } from './corpus-worker.js'

async function main(): Promise<void> {
  const payload = parseCorpusRefreshArgs(process.argv.slice(2))
  const result = await runCorpusRefresh({ payload })
  for (const slug of result.failedSources)
    console.warn(`::warning title=corpus 來源抓取失敗::${slug}`)
  console.warn(JSON.stringify({
    ...result,
    llmCostUsd: Number(getDailyCostGate().totalUsd.toFixed(4)),
  }, null, 2))
  process.exitCode = exitCodeFor(result)
}

main()
  .catch((err: unknown) => {
    console.error('[corpus-refresh] failed:', err)
    process.exitCode = 1
  })
  .finally(() => closeDb())
