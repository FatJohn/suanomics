// A/B 影子報告（#34）：拿某日正式報告存下的 run_inputs，關掉 corpus 檢索重跑一份，寫進 shadow_briefs，不發佈。
// `pnpm --filter @suanomics/pipeline run daily:shadow --date YYYY-MM-DD [--force]`
// 跑真 LLM（約 70 次呼叫、尖峰並行 9），先跟維護者確認花費。帳本 run_id 以 shadow- 開頭，與正式報告分得開。
import { randomUUID } from 'node:crypto'
import process from 'node:process'
import { DailyCostGate, installDailyCostGate, parseDailyCostLimit } from '../agents/cost-gate.js'
import { closeDb } from '../db/client.js'
import { dbLedger } from '../db/repos/llm-calls-repo.js'
import { getShadowBrief, getShadowSource, saveShadowBrief } from '../db/repos/shadow-briefs-repo.js'
import { parseDailyArgs } from './daily.cli-args.js'
import { generateBrief } from './run-brief.js'
import { runShadow } from './shadow.js'

async function main(): Promise<void> {
  const args = parseDailyArgs(process.argv.slice(2))
  const gate = new DailyCostGate(parseDailyCostLimit(process.env.DAILY_COST_LIMIT_USD), { ledger: dbLedger, runId: `shadow-${randomUUID()}` })
  installDailyCostGate(gate)
  const result = await runShadow(args, {
    gate,
    log: event => console.warn(JSON.stringify(event)),
    getSource: getShadowSource,
    getExisting: getShadowBrief,
    generateBrief,
    saveShadow: saveShadowBrief,
  })
  console.warn(JSON.stringify({ event: 'result', ...result, calls: gate.callCount, usd: Number(gate.totalUsd.toFixed(6)) }))
}

main()
  .catch((err: unknown) => {
    console.error('[daily:shadow] failed:', err)
    process.exitCode = 1
  })
  .finally(() => closeDb())
