// 對指定日期的 brief 跑 quality／continuity judge，逐日一次呼叫、序列執行。不在每日路徑上，手動或每週跑。
// 先 --dry-run 看每次呼叫的輸入長度（不打 LLM），估好呼叫數與費用再真跑（AGENTS.md 的批次規則）。
//
// DATABASE_URL 與 ANTHROPIC_API_KEY 用 op run 注入，例如：
//   ANTHROPIC_API_KEY='op://suanomics/Anthropic API Key/密碼' DATABASE_URL='op://suanomics/<item>/DATABASE_URL' \
//     op run --account johnnyhtw.1password.com -- pnpm --filter @suanomics/pipeline run eval:judge \
//     --dates 2026-11-11,2026-11-12 [--judge quality|continuity|all] [--max-usd 3] [--dry-run] [--out .eval-out/judge]
// 換 model 用 AGENT_MODELS，例如 AGENT_MODELS=brief-quality-judge:anthropic/claude-opus-5-5。

import type { AgentInput } from '../../src/agents/call-agent.js'
import type { AgentName } from '../../src/agents/models.js'
import type { ContinuityScore } from './continuity-judge.js'
import type { JudgeArgs } from './judge-args.js'
import type { JudgeCall } from './judge-call.js'
import type { JudgeRow } from './judge-report.js'
import type { QualityScore } from './quality-judge.js'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { callAgent } from '../../src/agents/call-agent.js'
import { DailyCostGate } from '../../src/agents/cost-gate.js'
import { resolveAgentModel } from '../../src/agents/models.js'
import { closeDb } from '../../src/db/client.js'
import { dbLedger } from '../../src/db/repos/llm-calls-repo.js'
import { runContinuityJudge } from './continuity-judge.js'
import { buildContinuityUserContent, CONTINUITY_JUDGE_SYSTEM_PROMPT } from './continuity-judge.prompt.js'
import { parseJudgeArgs } from './judge-args.js'
import { renderContinuityTable, renderQualityTable } from './judge-report.js'
import { loadContinuityInput, loadQualityFacts, loadStoredBrief } from './load-inputs.js'
import { runQualityJudge } from './quality-judge.js'
import { buildQualityUserContent, QUALITY_JUDGE_SYSTEM_PROMPT } from './quality-judge.prompt.js'

interface Runner { gate: DailyCostGate, lastCostUsd: number }

function makeCall(runner: Runner): JudgeCall {
  return async <T>(name: AgentName, input: AgentInput, schema: Parameters<typeof callAgent<T>>[2]) => {
    runner.lastCostUsd = 0
    return callAgent(name, input, schema, {
      gate: runner.gate,
      onCallRecord: (r) => { runner.lastCostUsd += r.costUsd ?? 0 },
    })
  }
}

function logDryRun(date: string, judge: string, systemPrompt: string, userContent: string): void {
  console.warn(JSON.stringify({ date, judge, systemChars: systemPrompt.length, userChars: userContent.length }))
}

async function judgeDate(date: string, args: JudgeArgs, runner: Runner, rows: { quality: JudgeRow<QualityScore>[], continuity: JudgeRow<ContinuityScore>[] }): Promise<void> {
  const stored = await loadStoredBrief(date)
  runner.gate.setReportDate(date)
  const call = makeCall(runner)
  if (args.judges.includes('quality')) {
    const input = { date, brief: stored.brief, facts: await loadQualityFacts(stored) }
    if (args.dryRun) {
      logDryRun(date, 'quality', QUALITY_JUDGE_SYSTEM_PROMPT, buildQualityUserContent(input))
    }
    else {
      const result = await runQualityJudge(input, call)
      writeFileSync(join(args.out, `${date}-quality.json`), JSON.stringify(result, null, 2))
      rows.quality.push({ date, score: result.score, costUsd: runner.lastCostUsd })
    }
  }
  if (args.judges.includes('continuity')) {
    const input = await loadContinuityInput(stored)
    if (input.priors.length === 0) {
      console.warn(`[eval:judge] ${date} 之前沒有 brief，略過 continuity`)
    }
    else if (args.dryRun) {
      logDryRun(date, 'continuity', CONTINUITY_JUDGE_SYSTEM_PROMPT, buildContinuityUserContent(input))
    }
    else {
      const result = await runContinuityJudge(input, call)
      writeFileSync(join(args.out, `${date}-continuity.json`), JSON.stringify(result, null, 2))
      rows.continuity.push({ date, score: result.score, costUsd: runner.lastCostUsd })
    }
  }
}

function summary(args: JudgeArgs, rows: { quality: JudgeRow<QualityScore>[], continuity: JudgeRow<ContinuityScore>[] }): string {
  const model = (name: AgentName) => resolveAgentModel(name).model
  const parts = [`# Judge 結果（${args.dates.join('、')}）`, '']
  if (rows.quality.length > 0)
    parts.push(`## quality（${model('brief-quality-judge')}）`, '', renderQualityTable(rows.quality), '')
  if (rows.continuity.length > 0)
    parts.push(`## continuity（${model('brief-continuity-judge')}）`, '', renderContinuityTable(rows.continuity), '')
  return parts.join('\n')
}

async function main(): Promise<void> {
  const args = parseJudgeArgs(process.argv.slice(2))
  mkdirSync(args.out, { recursive: true })
  const runner: Runner = { gate: new DailyCostGate(args.maxUsd, { ledger: dbLedger }), lastCostUsd: 0 }
  const rows = { quality: [] as JudgeRow<QualityScore>[], continuity: [] as JudgeRow<ContinuityScore>[] }
  for (const date of args.dates)
    await judgeDate(date, args, runner, rows)
  if (args.dryRun)
    return
  const text = summary(args, rows)
  writeFileSync(join(args.out, 'summary.md'), text)
  console.warn(text)
  console.warn(`totalUsd=${runner.gate.totalUsd.toFixed(4)} calls=${runner.gate.callCount}`)
}

main()
  .catch((err: unknown) => {
    console.error('[eval:judge] failed:', err)
    process.exitCode = 1
  })
  .finally(() => closeDb())
