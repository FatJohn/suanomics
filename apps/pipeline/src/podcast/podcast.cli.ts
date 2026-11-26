// 每日 podcast 的進入點：`pnpm --filter @suanomics/pipeline run podcast --date YYYY-MM-DD [--force]`。
// 讀當日 complete 的 brief 寫稿，Azure TTS 轉 MP3 後上傳 R2，網址寫回 daily_briefs。
import process from 'node:process'
import { getDailyCostGate } from '../agents/cost-gate.js'
import { closeDb } from '../db/client.js'
import { parseDailyArgs } from '../orchestrator/daily.cli-args.js'
import { readPodcastEnv } from './env.js'
import { createPodcastDeps } from './podcast.deps.js'
import { runPodcast } from './run.js'

async function main(): Promise<void> {
  const args = parseDailyArgs(process.argv.slice(2))
  const env = readPodcastEnv(process.env)
  // 先建閘：沒設 DAILY_COST_LIMIT_USD 時在寫稿之前就失敗。
  const gate = getDailyCostGate()
  gate.setReportDate(args.date)
  const result = await runPodcast(args, createPodcastDeps(env))
  console.warn(JSON.stringify({ event: 'result', ...result, llmCostUsd: Number(gate.totalUsd.toFixed(4)) }))
}

main()
  .catch((err: unknown) => {
    console.error('[podcast] failed:', err)
    process.exitCode = 1
  })
  .finally(() => closeDb())
