// #125 的比較：對已發佈的報告日跑一次 narrative 審稿與修訂，有修訂時用 quality judge 評修訂稿。
// 無審稿組直接用正式報告（已有排程 judge 的結果），不重跑 narrative，也不寫回任何報告。
// 帳本用 shadow- 開頭的 run id，排程 judge 不會因此把該日當成已評過。
// 先 --dry-run 看輸入長度（不打 LLM）；judge 要與 judge.yml 同 model 才能和排程結果比，例如：
//   DAILY_TOTAL_COST_LIMIT_USD=3.00 AGENT_MODELS=brief-quality-judge:anthropic/claude-opus-5-5 \
//     ANTHROPIC_API_KEY='op://suanomics/<item>/password' DATABASE_URL='op://suanomics/<item>/DATABASE_URL' \
//     op run --account johnnyhtw.1password.com -- pnpm --filter @suanomics/pipeline run eval:review-ab \
//     --dates 2026-11-25,2026-11-26,2026-11-27 [--max-usd 1.2] [--dry-run] [--out .eval-out/review-ab]

import type { AgentInput } from '../../src/agents/call-agent.js'
import type { AgentName } from '../../src/agents/models.js'
import type { NarrativeReview } from '../../src/agents/narrative-review.js'
import type { QualityJudgeResult } from './quality-judge.js'
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { callAgent } from '../../src/agents/call-agent.js'
import { DailyCostGate, installDailyCostGate } from '../../src/agents/cost-gate.js'
import { createSharedDailyCostGate } from '../../src/agents/daily-budget.js'
import { reviewNarrative, reviseNarrative } from '../../src/agents/narrative-review.js'
import { closeDb } from '../../src/db/client.js'
import { dbLedger, getSpentTodayUsd } from '../../src/db/repos/llm-calls-repo.js'
import { getShadowSource, SHADOW_RUN_ID_PREFIX } from '../../src/db/repos/shadow-briefs-repo.js'
import { parseRunInputs } from '../../src/orchestrator/shadow.js'
import { formatReviewerUserContent } from '../../src/prompts/narrative-review.user-content.js'
import { parseDates, parseMaxUsd } from './judge-args.js'
import { loadQualityFacts, loadStoredBrief } from './load-inputs.js'
import { runQualityJudge } from './quality-judge.js'
import { reviewMaterialFromStored } from './review-ab.js'

interface Args { dates: string[], maxUsd: number, dryRun: boolean, out: string }

interface Row { date: string, review: NarrativeReview | null, revised: boolean, quality: QualityJudgeResult | null, costUsd: number }

function parseArgs(argv: readonly string[]): Args {
  const values: Record<string, string | undefined> = {}
  let dryRun = false
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--')
      continue
    if (arg === '--dry-run')
      dryRun = true
    else if (arg === '--dates' || arg === '--max-usd' || arg === '--out')
      values[arg] = argv[++i]
    else
      throw new Error(`未知參數：${arg}`)
  }
  return {
    dates: parseDates(values['--dates']),
    maxUsd: values['--max-usd'] === undefined ? 1.2 : parseMaxUsd(values['--max-usd']),
    dryRun,
    out: values['--out'] ?? '.eval-out/review-ab',
  }
}

const judgeCall = <T>(name: AgentName, input: AgentInput, schema: Parameters<typeof callAgent<T>>[2]): Promise<T> => callAgent(name, input, schema)

async function compareDate(date: string, args: Args, gate: DailyCostGate): Promise<Row | null> {
  const stored = await loadStoredBrief(date)
  const source = await getShadowSource(date)
  if (stored === null || source === null)
    throw new Error(`${date} 沒有 complete 的 daily_briefs`)
  const draft = stored.brief.narrative
  if (!draft) {
    console.warn(`[eval:review-ab] ${date} 的報告沒有 narrative，略過`)
    return null
  }
  const material = reviewMaterialFromStored(date, stored.brief, parseRunInputs(date, source.runInputs))
  if (args.dryRun) {
    console.warn(JSON.stringify({ date, reviewerUserChars: formatReviewerUserContent(material, draft).length }))
    return null
  }
  gate.setReportDate(date)
  const before = gate.totalUsd
  const review = await reviewNarrative(material, draft)
  const revised = review && !review.ok ? (await reviseNarrative(material, draft, review.notes)).narrative : null
  const quality = revised
    ? await runQualityJudge({ date, brief: { ...stored.brief, narrative: revised }, facts: await loadQualityFacts(stored) }, judgeCall)
    : null
  writeFileSync(join(args.out, `${date}-review.json`), JSON.stringify({ date, review, before: draft, revised, quality }, null, 2))
  return { date, review, revised: revised !== null, quality, costUsd: gate.totalUsd - before }
}

function summary(rows: readonly Row[]): string {
  const lines = [
    '# narrative 審稿比較（#125）',
    '',
    '修訂後的 quality 分數要與同日排程 judge 的結果（judge.yml artifact）對照。',
    '',
    '| 日期 | 意見 | 類型 | 修訂 | 修訂後 unsupported 數字 | 事件 | chain pass | mechanism pass | 花費 |',
    '|---|---|---|---|---|---|---|---|---|',
  ]
  for (const r of rows) {
    const s = r.quality?.score
    const notes = r.review === null ? '審稿失敗' : String(r.review.notes.length)
    const kinds = r.review?.notes.map(n => n.kind).join('、') || '—'
    const scores = s ? [s.unsupportedNumbers, s.unsupportedEvents, `${s.chainPass}/${s.sections}`, `${s.mechanismPass}/${s.sections}`] : ['—', '—', '—', '—']
    lines.push(`| ${r.date} | ${notes} | ${kinds} | ${r.revised ? '是' : '否'} | ${scores.join(' | ')} | $${r.costUsd.toFixed(4)} |`)
  }
  return `${lines.join('\n')}\n`
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  mkdirSync(args.out, { recursive: true })
  const gate = args.dryRun
    ? new DailyCostGate(args.maxUsd)
    : await createSharedDailyCostGate({
        stepLimitUsd: args.maxUsd,
        totalLimitRaw: process.env.DAILY_TOTAL_COST_LIMIT_USD,
        getSpentTodayUsd,
        gateOptions: { ledger: dbLedger, runId: `${SHADOW_RUN_ID_PREFIX}review-ab-${randomUUID()}` },
        log: event => console.warn(JSON.stringify(event)),
      })
  installDailyCostGate(gate)
  const rows: Row[] = []
  for (const date of args.dates) {
    const row = await compareDate(date, args, gate)
    if (row)
      rows.push(row)
  }
  if (args.dryRun)
    return
  const text = summary(rows)
  writeFileSync(join(args.out, 'summary.md'), text)
  console.warn(text)
  console.warn(`totalUsd=${gate.totalUsd.toFixed(4)} calls=${gate.callCount}`)
}

main()
  .catch((err: unknown) => {
    console.error('[eval:review-ab] failed:', err)
    process.exitCode = 1
  })
  .finally(() => closeDb())
