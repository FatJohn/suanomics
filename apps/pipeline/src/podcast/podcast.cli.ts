// 每日 podcast 的進入點：`pnpm --filter @suanomics/pipeline run podcast --date YYYY-MM-DD [--force]`。
// 讀當日 complete 的 brief 寫稿，Azure TTS 轉 MP3 後上傳 R2，網址寫回 daily_briefs。
import type { DailyCostGate } from '../agents/cost-gate.js'
import type { PodcastResult } from './run.js'
import process from 'node:process'
import { installSharedDailyCostGate } from '../agents/daily-budget.js'
import { closeDb } from '../db/client.js'
import { parseDailyArgs } from '../orchestrator/daily.cli-args.js'
import { readPodcastEnv } from './env.js'
import { createPodcastDeps } from './podcast.deps.js'
import { runPodcast } from './run.js'
import { appendPodcastSummary, renderPodcastSummary } from './summary.js'

async function main(): Promise<void> {
  let gate: DailyCostGate | undefined
  let date: string | undefined
  let ttsChars: number | undefined
  let result: PodcastResult | undefined
  try {
    const args = parseDailyArgs(process.argv.slice(2))
    date = args.date
    const env = readPodcastEnv(process.env)
    // 先建閘：沒設 DAILY_COST_LIMIT_USD 或 DAILY_TOTAL_COST_LIMIT_USD 時在寫稿之前就失敗。
    gate = await installSharedDailyCostGate()
    gate.setReportDate(args.date)
    const deps = createPodcastDeps(env)
    const log = deps.log
    deps.log = (event) => {
      if (event.event === 'podcast_tts')
        ttsChars = event.billableChars
      log(event)
    }
    result = await runPodcast(args, deps)
    console.warn(JSON.stringify({ event: 'result', ...result, llmCostUsd: Number(gate.totalUsd.toFixed(4)) }))
  }
  finally {
    const llm = { usd: gate?.totalUsd ?? 0, calls: gate?.callCount ?? 0 }
    await appendPodcastSummary(process.env.GITHUB_STEP_SUMMARY, renderPodcastSummary({ llm, result, ...(date ? { date } : {}), ...(ttsChars === undefined ? {} : { ttsChars }) }))
  }
}

main()
  .catch((err: unknown) => {
    console.error('[podcast] failed:', err)
    process.exitCode = 1
  })
  .finally(() => closeDb())
