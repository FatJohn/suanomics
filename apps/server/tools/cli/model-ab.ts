#!/usr/bin/env tsx
/* eslint-disable no-console -- 這支 CLI 的產品就是 stdout 上的報表 */
import type { ArmPlanEntry } from '../eval/model-ab/arms.js'
import type { ModelAbTarget, TargetRunInput } from '../eval/model-ab/targets.js'
import type { RunFile } from '../eval/model-ab/types.js'
import { dirname, resolve } from 'node:path'
import process, { exit } from 'node:process'
import { fileURLToPath } from 'node:url'
import { Command } from 'commander'
import { AGENT_MODEL_DEFAULTS, resolveAgentModel } from '../../src/agents/providers/resolve.js'
import { canaryExampleBanner, canaryExampleNotice, listCanaryDates } from '../eval/canary-fixtures.js'
import { armLabels, planArms } from '../eval/model-ab/arms.js'
import { renderProseReport, renderStructuredReport } from '../eval/model-ab/report.js'
import { loadSamples, probeModelVersions, readRunFile, TARGETS, writeRunFile } from '../eval/model-ab/targets.js'
import { enforceLlmRunBudget } from './lib/llm-run-budget.js'
import { parseDateList, requireGeminiKeyOrExit } from './lib/smoke-args.js'

// 換 model 前的迴歸量測工具。
//
// 設計上的一條硬規則：**每臂預設跑兩次**。跨臂差異必須跟「同一個 model 自己跑兩次的
// 差異」比才有意義，否則量到的是模型抖動不是 model 差異（2026-08-02 實測會判反方向）。

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT_ROOT = resolve(HERE, '../../.eval-out/model-ab')

interface Opts {
  agent: string
  modelA?: string
  modelB?: string
  replicates: string
  samples: string
  concurrency: string
  diverge: string
  dates?: string
  analyze?: boolean
  probe?: boolean
  yes?: boolean
}

function pickTarget(alias: string): ModelAbTarget {
  const t = TARGETS[alias]
  if (!t) {
    console.error(`unknown --agent=${alias}；可用：${Object.keys(TARGETS).join(' | ')}`)
    exit(1)
  }
  return t
}

async function runArm(
  target: ModelAbTarget,
  entry: ArmPlanEntry,
  input: Omit<TargetRunInput, 'label'>,
): Promise<RunFile> {
  // resolveAgentModel 每次呼叫都重讀 env、無 memoize，所以同一個 process 內就能切臂。
  process.env.AGENT_MODELS = `${target.agentName}:${entry.model}`
  const resolved = resolveAgentModel(target.agentName)
  console.log(`\n[arm ${entry.label}] AGENT_MODELS=${process.env.AGENT_MODELS} -> resolveAgentModel = ${JSON.stringify(resolved)}`)
  const t0 = Date.now()
  const out = await target.run({ ...input, label: entry.label })
  const run: RunFile = {
    label: entry.label,
    agent: target.agentName,
    configuredModel: entry.model,
    resolvedModel: resolved.model,
    startedAt: new Date(t0).toISOString(),
    articles: out.articles,
    ...(out.calls ? { calls: out.calls } : {}),
    ...(out.artifacts ? { artifacts: out.artifacts } : {}),
  }
  console.log(`[arm ${entry.label}] done in ${((Date.now() - t0) / 1000).toFixed(1)}s -> ${writeRunFile(input.outDir, run)}`)
  return run
}

async function collectRuns(target: ModelAbTarget, o: Opts, outDir: string): Promise<RunFile[]> {
  if (o.analyze) {
    // 模型名稱以 run 檔為準（--model-* 在這條路徑無意義、agent 預設也可能早就換過了）
    const runs = armLabels(Number(o.replicates)).map(l => readRunFile(outDir, l))
    console.log(`受測 ${target.agentName}（--analyze：讀既有 run 檔、不打 API）｜${runs.map(r => `${r.label}=${r.resolvedModel}`).join(' ')}`)
    return runs
  }
  if (!o.modelB) {
    console.error('缺 --model-b（候選 model）。--model-a 省略時取該 agent 現行預設。')
    exit(1)
  }
  const modelA = o.modelA ?? AGENT_MODEL_DEFAULTS[target.agentName]
  const plan = planArms({ modelA, modelB: o.modelB, replicates: Number(o.replicates) })
  const dates = parseDateList(o.dates) ?? listCanaryDates()
  const samples = target.input === 'samples' ? loadSamples(Number(o.samples)) : []
  console.log(
    `受測 ${target.agentName}｜A=${modelA} B=${o.modelB}｜臂 ${plan.map(p => p.label).join(',')}${
      target.input === 'samples' ? `｜樣本 ${samples.length} 篇（canary fixture 去重後）` : `｜日期 ${dates.join(',')}`}`,
  )
  // --analyze／--probe 都在進到這裡之前就 return（見 run()），不會被這道閘門擋到。
  const concurrency = Number(o.concurrency)
  enforceLlmRunBudget(
    {
      script: 'model-ab',
      terms: [{
        label: `${target.agentName}`,
        units: 1,
        callsPerUnit: target.estimateCalls({ armCount: plan.length, sampleCount: samples.length, dateCount: dates.length }),
        httpMultiplier: 3,
        basis: `TARGETS['${target.agentName}' target].estimateCalls（arms=${plan.length}, samples=${samples.length}, dates=${dates.length}）`,
      }],
      peak: target.estimatePeak({ armCount: plan.length, sampleCount: samples.length, dateCount: dates.length, concurrency }),
      peakBasis: `TARGETS['${target.agentName}' target].estimatePeak`,
      caveats: [],
    },
    { confirmed: o.yes === true, errLog: line => console.error(line), exit },
  )
  const runs: RunFile[] = []
  // 序列跑：共用同一把 Gemini key、兩臂並行會撞 RPM
  for (const entry of plan)
    runs.push(await runArm(target, entry, { samples, dates, concurrency: Number(o.concurrency), outDir, log: l => console.log(l) }))
  return runs
}

async function run(alias: string, o: Opts): Promise<void> {
  const notice = canaryExampleNotice()
  if (notice !== null)
    console.warn(notice)
  const target = pickTarget(alias)
  const outDir = resolve(OUT_ROOT, alias)

  if (o.probe) {
    const key = requireGeminiKeyOrExit('pnpm model:ab（會吃 apps/server/.env）')
    const models = [o.modelA ?? AGENT_MODEL_DEFAULTS[target.agentName], o.modelB].filter((m): m is string => Boolean(m))
    for (const line of await probeModelVersions(models, key))
      console.log(`[probe] ${line}`)
    return
  }

  const runs = await collectRuns(target, o, outDir)
  const lines = target.mode === 'prose'
    ? renderProseReport({ agentName: target.agentName, runs })
    : renderStructuredReport({ agentName: target.agentName, runs, divergenceField: target.divergenceField, divergeN: Number(o.diverge) })
  // 這支 CLI 沒有落檔的報告——輸出全在 stdout——所以橫幅接在印出來的第一行，
  // 跟另外三支「接在報告字串最前面」是同一件事，只是載體是終端輸出而非檔案。
  const banner = canaryExampleBanner()
  console.log(`\n${banner !== null ? `${banner}\n\n` : ''}${lines.join('\n')}`)
}

const program = new Command()
program
  .name('model-ab')
  .description('換 model 前的迴歸量測：每臂預設跑兩次，同時報同臂雜訊底線與跨臂差異')
  .argument('[agent]', `受測 agent：${Object.keys(TARGETS).join(' | ')}`, 'entity-summary')
  .option('--model-a <model>', 'A 臂 model（省略＝該 agent 現行預設）')
  .option('--model-b <model>', 'B 臂 model（候選）')
  .option('--replicates <n>', '每臂跑幾次；預設 2＝同臂對照組，低於 2 就量不到雜訊底線', '2')
  .option('--samples <n>', '取樣上限（structured 模式）', '9999')
  .option('--dates <list>', '逗號分隔日期（prose 模式；預設全部 canary 日）')
  .option('--concurrency <n>', '並行呼叫數（Gemini 有 RPM 限制、別調太高）', '4')
  .option('--diverge <n>', '印出分歧最大的 N 篇（質性抽查用）', '10')
  .option('--analyze', '不打 API、只用已存的 run 檔重算指標')
  .option('--probe', '只驗兩個 model 名稱是不是不同的真實 backend')
  .option('--yes', '略過並行預算警告、強制執行（預估超過 500 次呼叫或尖峰超過 10 時需要）')
  .action((agent: string, opts: Opts) => run(agent, opts).then(() => exit(0)).catch((err: Error) => {
    console.error(err.stack ?? err.message)
    exit(1)
  }))

program.parseAsync(process.argv).catch((err: Error) => {
  console.error(err.stack ?? err.message)
  exit(1)
})
