#!/usr/bin/env tsx
/* eslint-disable no-console -- worker progress logging */
import type { LlmCallRecord } from '../../src/agents/llm-wrapper.js'
import type { ContinuityReportMeta } from '../eval/continuity-report.js'
import type { DimWinner } from '../eval/pairwise.js'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process, { exit } from 'node:process'
import { Command } from 'commander'
import { resolveAgentModel } from '../../src/agents/providers/resolve.js'
import { runContinuityCompare } from '../eval/continuity-judge.js'
import { buildContinuityReport } from '../eval/continuity-report.js'
import { loadBrief } from '../eval/load-brief.js'
import { appendTrendRow } from '../eval/trend-log.js'

const OUT_DIR = '.eval-out'

interface ContinuityOpts { prev: string, todayA: string, todayB: string, labelA: string, labelB: string, trend?: string }

async function runContinuity(opts: ContinuityOpts): Promise<void> {
  const yesterday = loadBrief(opts.prev)
  const todayA = loadBrief(opts.todayA)
  const todayB = loadBrief(opts.todayB)

  const { model } = resolveAgentModel('brief-continuity-judge')

  let tokensIn = 0
  let tokensOut = 0
  let costUsd = 0
  const onCallRecord = (r: LlmCallRecord): void => {
    tokensIn += r.tokensIn
    tokensOut += r.tokensOut
    costUsd += r.costUsd
  }

  const result = await runContinuityCompare({ todayA, todayB, yesterday, onCallRecord })

  const meta: ContinuityReportMeta = { labelA: opts.labelA, labelB: opts.labelB, model, tokensIn, tokensOut, costUsd }
  const markdown = buildContinuityReport(result, meta)

  const outDir = resolve(OUT_DIR)
  mkdirSync(outDir, { recursive: true })
  const outPath = resolve(outDir, `continuity-${opts.labelA}-vs-${opts.labelB}.md`)
  writeFileSync(outPath, markdown, 'utf8')

  console.log(outPath)
  console.log(`跨日連貫=${result.crossDay.winner} 論點演進=${result.thesisDelta.winner} 伏筆兌現=${result.resolvePayoff.winner}`)
  console.log(`judge cost：$${costUsd.toFixed(4)}（in ${tokensIn} / out ${tokensOut}）`)

  if (opts.trend !== undefined) {
    const w = (x: DimWinner): string => (x === 'A' ? opts.labelA : x === 'B' ? opts.labelB : 'tie')
    await appendTrendRow(opts.trend, {
      date: new Date().toISOString().slice(0, 10),
      tool: 'continuity',
      label: `${opts.labelA} vs ${opts.labelB}`,
      verdict: `跨日:${w(result.crossDay.winner)} 論點:${w(result.thesisDelta.winner)} 伏筆:${w(result.resolvePayoff.winner)}`,
      cost: costUsd,
    })
    console.log(`已記趨勢：${opts.trend}`)
  }
}

const program = new Command()
program
  .name('brief-continuity')
  .description('Pairwise-compare two same-day briefs on cross-day continuity (yesterday as baseline)')
  .requiredOption('-p, --prev <path>', '昨日（N-1）brief JSON 檔路徑（連續性基準線）')
  .requiredOption('--today-a <path>', '今日 A 版 brief JSON 檔路徑')
  .requiredOption('--today-b <path>', '今日 B 版 brief JSON 檔路徑')
  .option('--labelA <label>', 'A 的標籤', 'A')
  .option('--labelB <label>', 'B 的標籤', 'B')
  .option('--trend <path>', '將本次三維勝負摘要 append 到趨勢日誌（如品質趨勢日誌）')
  .action((opts: ContinuityOpts) => runContinuity(opts).then(() => exit(0)).catch((err: Error) => {
    console.error(err.stack ?? err.message)
    exit(1)
  }))

program.parseAsync(process.argv).catch((err: Error) => {
  console.error(err.stack ?? err.message)
  exit(1)
})
