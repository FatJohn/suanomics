// A/B 影子報告（#34）：拿某日正式報告存下的 run_inputs，關掉 corpus 檢索重跑一份，寫進 shadow_briefs，不發佈。
// `pnpm --filter @suanomics/pipeline run daily:shadow --date YYYY-MM-DD [--force]`
// 跑真 LLM（約 70 次呼叫、尖峰並行 9），先跟維護者確認花費。花費閘上限是 DAILY_COST_LIMIT_USD 扣掉今天帳本已花的金額。帳本 run_id 以 shadow- 開頭，與正式報告分得開。
// 要帶 ANALYST_CLAIMS_ENABLED=true、NARRATIVE_LEDGER_ENABLED=true（與 daily.yml 相同），沒帶就不跑。
import { randomUUID } from 'node:crypto'
import process from 'node:process'
import { taipeiDateOf } from '@suanomics/shared'
import { DailyCostGate, installDailyCostGate, parseDailyCostLimit } from '../agents/cost-gate.js'
import { closeDb } from '../db/client.js'
import { dbLedger, getDailyUsage } from '../db/repos/llm-calls-repo.js'
import { getShadowBrief, getShadowSource, saveShadowBrief, SHADOW_RUN_ID_PREFIX } from '../db/repos/shadow-briefs-repo.js'
import { parseDailyArgs } from './daily.cli-args.js'
import { generateBrief } from './run-brief.js'
import { requireDailyFeatureFlags, runShadow, shadowCostLimit } from './shadow.js'

async function main(): Promise<void> {
  const args = parseDailyArgs(process.argv.slice(2))
  requireDailyFeatureFlags(process.env)
  const today = taipeiDateOf(new Date())
  const spentToday = (await getDailyUsage(1)).find(d => d.day === today)?.totalUsd ?? 0
  const limit = shadowCostLimit(parseDailyCostLimit(process.env.DAILY_COST_LIMIT_USD), spentToday)
  console.warn(JSON.stringify({ event: 'shadow_cost_limit', spentToday, limit }))
  const gate = new DailyCostGate(limit, { ledger: dbLedger, runId: `${SHADOW_RUN_ID_PREFIX}${randomUUID()}` })
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
