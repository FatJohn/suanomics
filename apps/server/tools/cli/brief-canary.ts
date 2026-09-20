#!/usr/bin/env tsx
/* eslint-disable no-console -- worker progress logging */
import type { LlmCallRecord } from '../../src/agents/llm-wrapper.js'
import type { DimWinner } from '../eval/pairwise.js'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process, { exit } from 'node:process'
import { Command } from 'commander'
import { CANARY_DIR, canaryDatePath, canaryExampleBanner, canaryExampleNotice, listCanaryDates } from '../eval/canary-fixtures.js'
import { ablateBrief } from '../eval/canary.js'
import { isValidEvalDate } from '../eval/date.js'
import { loadBrief } from '../eval/load-brief.js'
import { normalizeSourceItems } from '../eval/quality-input.js'
import { runQualityCompare } from '../eval/quality-judge.js'
import { appendTrendRow } from '../eval/trend-log.js'
import { enforceLlmRunBudget } from './lib/llm-run-budget.js'
import { estimateBriefCanary } from './lib/llm-run-estimates.js'

const OUT_DIR = '.eval-out'

interface CanaryOpts { date?: string, trend?: string, yes?: boolean }

async function runOne(date: string, trend?: string): Promise<void> {
  const base = canaryDatePath(date)
  const full = loadBrief(resolve(base, 'brief.json'))
  const ablated = ablateBrief(full)
  const sources = normalizeSourceItems(JSON.parse(readFileSync(resolve(base, 'sources.json'), 'utf8')) as unknown)

  let costUsd = 0
  let tokensIn = 0
  let tokensOut = 0
  const onCallRecord = (r: LlmCallRecord): void => {
    costUsd += r.costUsd
    tokensIn += r.tokensIn
    tokensOut += r.tokensOut
  }

  const result = await runQualityCompare({ briefA: full, briefB: ablated, sources, onCallRecord })

  const outDir = resolve(OUT_DIR)
  mkdirSync(outDir, { recursive: true })
  const banner = canaryExampleBanner()
  const md = [
    ...(banner !== null ? [banner, ''] : []),
    `# Canary content-ablation：${date}（full vs no-thesis-vp）`,
    '',
    `- 深度：${result.depth.winner}｜理由 ${result.depth.reasons.join(' / ')}`,
    `- 可讀：${result.readability.winner}｜理由 ${result.readability.reasons.join(' / ')}`,
    `- grounding：${result.grounding.winner}｜理由 ${result.grounding.reasons.join(' / ')}`,
    `- 事實底本新聞數：${sources.length}｜cost $${costUsd.toFixed(4)}（in ${tokensIn} / out ${tokensOut}）`,
  ].join('\n')
  writeFileSync(resolve(outDir, `canary-${date}.md`), md, 'utf8')

  console.log(`[${date}] 深度=${result.depth.winner} 可讀=${result.readability.winner} grounding=${result.grounding.winner} cost=$${costUsd.toFixed(4)}`)

  if (trend !== undefined) {
    // full=A、ablated=B：勝方 A = 「有 thesis+viewpoints 更好」、B = 「拿掉反而更好」、tie = 無差。
    const w = (x: DimWinner): string => (x === 'A' ? 'full' : x === 'B' ? 'no-thesis-vp' : 'tie')
    await appendTrendRow(trend, {
      date: new Date().toISOString().slice(0, 10),
      tool: 'quality',
      label: `content-ablation: full vs no-thesis-vp (${date})`,
      verdict: `深度:${w(result.depth.winner)} 可讀:${w(result.readability.winner)} grounding:${w(result.grounding.winner)}`,
      cost: costUsd,
    })
    console.log(`  已記趨勢：${trend}`)
  }
}

async function run(opts: CanaryOpts): Promise<void> {
  const notice = canaryExampleNotice()
  if (notice !== null)
    console.warn(notice)
  const dates = opts.date !== undefined ? [opts.date] : listCanaryDates()
  if (opts.date !== undefined && !isValidEvalDate(opts.date)) {
    console.error(`--date 格式錯誤（需 YYYY-MM-DD）：${opts.date}`)
    exit(1)
  }
  if (dates.length === 0) {
    console.error(`canary fixtures 目錄無可用日期：${CANARY_DIR}`)
    exit(1)
  }
  // 多天迴圈是這支腳本唯一會撞到批次風險門檻的地方（單天只有 2 次 judge 呼叫）。
  enforceLlmRunBudget(estimateBriefCanary(dates.length), {
    confirmed: opts.yes === true,
    errLog: line => console.error(line),
    exit,
  })
  for (const d of dates)
    await runOne(d, opts.trend)
}

const program = new Command()
program
  .name('brief-canary')
  .description('對 canary fixtures 跑 content-ablation（full vs 拿掉 thesis+viewpoints）pairwise')
  .option('-d, --date <YYYY-MM-DD>', '只跑單一 canary 日（預設掃全部）')
  .option('--trend <path>', '將每日三維勝負 append 到趨勢日誌')
  .option('--yes', '略過並行預算警告、強制執行（預估超過 500 次呼叫或尖峰超過 10 時需要）')
  .action((opts: CanaryOpts) => run(opts).then(() => exit(0)).catch((err: Error) => {
    console.error(err.stack ?? err.message)
    exit(1)
  }))

program.parseAsync(process.argv).catch((err: Error) => {
  console.error(err.stack ?? err.message)
  exit(1)
})
