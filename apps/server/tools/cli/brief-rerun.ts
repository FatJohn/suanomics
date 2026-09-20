#!/usr/bin/env tsx
/* eslint-disable no-console -- CLI 摘要輸出 */

// 同素材重跑：對某天的原始素材套用「現在的」pipeline 重新產出、
// 只寫成檔案、完全不寫 DB。**絕對不呼叫 saveDailyBrief／applyEditorResult／任何
// enqueue**——processBriefJob 的 saveDailyBrief 是 onConflictDoUpdate on brief_date，
// 走正式路徑重跑會直接覆蓋掉當天原本的 brief，讓「重跑」與「保留原版供比較」互斥。
// 這支腳本存在正是為了讓兩者不互斥：呼叫 generateDailyBrief（只產生、不持久化）
// 產完直接落地成三個檔，供 brief:quality / brief:canary 之類的工具事後讀。
import type { SkipReason } from '@suanomics/shared'
import type { LlmCallRecord } from '../../src/agents/llm-wrapper.js'
import type { BriefNews } from '../../src/jobs/handlers/brief-generate.js'
import type { HistoricalAsOf } from '../../src/market-data/historical-asof.js'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process, { exit } from 'node:process'
import { fileURLToPath } from 'node:url'
import { Command } from 'commander'
import { resolveAgentModel } from '../../src/agents/providers/resolve.js'
import { generateDailyBrief } from '../../src/jobs/handlers/brief-generate.js'
import { formatAsOfNotice, loadHistoricalSeriesAsOf } from '../../src/market-data/historical-asof.js'
import { isValidEvalDate } from '../eval/date.js'
import { enforceLlmRunBudget } from './lib/llm-run-budget.js'
import { estimateBriefRerun } from './lib/llm-run-estimates.js'
import { requireGeminiKeyOrExit } from './lib/smoke-args.js'

export interface RerunLlmCallSummary {
  agent: string
  model: string
  costUsd: number
  latencyMs: number
  tokensIn: number
  tokensOut: number
}

function toLlmCallSummary(r: LlmCallRecord): RerunLlmCallSummary {
  const { model } = resolveAgentModel(r.agentName)
  return { agent: r.agentName, model, costUsd: r.costUsd, latencyMs: r.latencyMs, tokensIn: r.tokensIn, tokensOut: r.tokensOut }
}

/**
 * 本次重跑的 as-of 重建狀況，落地成 meta.json 的一部分——這是事後判讀
 * 「這次比較能不能比 grounding」的唯一憑據，不能只印在終端機捲走。
 * `source: null` = 找不到原版 brief 的 dataFreshness（無法重建），快照可能含報告日
 * 之後才抓到的資料；`'original-brief'` = 已重建，`missing` 是回退到 reportDate 的序列。
 */
export interface RerunSeriesAsOfMeta {
  source: 'original-brief' | null
  covered: number
  missing: string[]
  /**
   * 射程說明，逐字落進 meta.json——`source: 'original-brief'` 與 `covered: 26` 讀起來
   * 像「素材完全同一份」，但還原的只有 as-of 日期。沒有這句，下一個讀 meta.json 的人
   * 會拿它當數值也還原了的保證。
   */
  note: string
}

const RESTORED_NOTE = '只還原逐序列的 as-of 日期；數值是現在 DB 的最新值，修正型序列（CPI、非農）可能是後來的修正版'
const NOT_RESTORED_NOTE = 'as-of 未重建：快照可能含報告日之後才抓到的資料，grounding 維度的比較不可信'

function toRerunSeriesAsOfMeta(historicalAsOf: HistoricalAsOf | null): RerunSeriesAsOfMeta {
  if (!historicalAsOf)
    return { source: null, covered: 0, missing: [], note: NOT_RESTORED_NOTE }
  return { source: 'original-brief', covered: historicalAsOf.covered.length, missing: historicalAsOf.missing, note: RESTORED_NOTE }
}

export interface RerunMeta {
  date: string
  label: string
  replicate: number
  generatedAt: string
  selectedNewsIds: number[]
  headline: string
  pubDayKind: string
  llmCalls: RerunLlmCallSummary[]
  totalCostUsd: number
  totalLatencyMs: number
  seriesAsOf: RerunSeriesAsOfMeta
}

interface BuildRerunMetaInput {
  date: string
  label: string
  replicate: number
  generatedAt: string
  selectedNewsIds: number[]
  headline: string
  pubDayKind: string
  llmCalls: LlmCallRecord[]
  historicalAsOf: HistoricalAsOf | null
}

export function buildRerunMeta(input: BuildRerunMetaInput): RerunMeta {
  const llmCalls = input.llmCalls.map(toLlmCallSummary)
  return {
    date: input.date,
    label: input.label,
    replicate: input.replicate,
    generatedAt: input.generatedAt,
    selectedNewsIds: input.selectedNewsIds,
    headline: input.headline,
    pubDayKind: input.pubDayKind,
    llmCalls,
    totalCostUsd: llmCalls.reduce((s, c) => s + c.costUsd, 0),
    totalLatencyMs: llmCalls.reduce((s, c) => s + c.latencyMs, 0),
    seriesAsOf: toRerunSeriesAsOfMeta(input.historicalAsOf),
  }
}

export interface RerunSourceItem { id: number, title: string, url: string, contentText: string, publishedAt: string | null }

export function toSourcesJson(news: readonly BriefNews[]): RerunSourceItem[] {
  return news.map(n => ({ id: n.id, title: n.title, url: n.url, contentText: n.text, publishedAt: n.publishedAt }))
}

export function rerunOutputDir(out: string, date: string, label: string, replicate: number): string {
  return resolve(out, date, `${label}-${replicate}`)
}

/** 目錄已存在時的拒絕：拒絕覆蓋既有輸出，讓呼叫端決定要 exit 幾。 */
export class RerunDirExistsError extends Error {
  constructor(public readonly dir: string) {
    super(`輸出目錄已存在、拒絕覆蓋：${dir}`)
    this.name = 'RerunDirExistsError'
  }
}

/** 非應產日（週六／假日）：generateDailyBrief 回 skip、沒有東西可寫。 */
export class RerunSkippedError extends Error {
  constructor(public readonly date: string, public readonly reason?: SkipReason) {
    super(`${date} 非應產日、不產出${reason ? `（reason=${reason}）` : ''}`)
    this.name = 'RerunSkippedError'
  }
}

interface ReplicateOpts { date: string, out: string, label: string }

/**
 * 產生單一 replicate 並落地三個檔（brief.json / sources.json / meta.json）。
 * 先檢查目錄是否已存在（fail-fast、不浪費一次 LLM 呼叫）、再呼叫 generateDailyBrief。
 */
export async function generateReplicateToFiles(opts: ReplicateOpts, replicate: number, historicalAsOf: HistoricalAsOf | null = null): Promise<RerunMeta> {
  const dir = rerunOutputDir(opts.out, opts.date, opts.label, replicate)
  if (existsSync(dir))
    throw new RerunDirExistsError(dir)

  const llmCalls: LlmCallRecord[] = []
  const result = await generateDailyBrief(
    opts.date,
    r => llmCalls.push(r),
    historicalAsOf ? { seriesAsOf: historicalAsOf.seriesAsOf } : undefined,
  )
  if (result.kind === 'skip')
    throw new RerunSkippedError(opts.date, result.reason)

  const meta = buildRerunMeta({
    date: opts.date,
    label: opts.label,
    replicate,
    generatedAt: new Date().toISOString(),
    selectedNewsIds: result.news.map(n => n.id),
    headline: result.brief.headline,
    pubDayKind: result.pubDay.kind,
    llmCalls,
    historicalAsOf,
  })

  mkdirSync(dir, { recursive: true })
  writeFileSync(resolve(dir, 'brief.json'), JSON.stringify(result.brief, null, 2), 'utf8')
  writeFileSync(resolve(dir, 'sources.json'), JSON.stringify(toSourcesJson(result.news), null, 2), 'utf8')
  writeFileSync(resolve(dir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8')

  return meta
}

interface RerunCliOpts { date: string, out: string, label: string, replicates: number, yes?: boolean }

async function run(opts: RerunCliOpts): Promise<void> {
  if (!isValidEvalDate(opts.date)) {
    console.error(`--date 格式錯誤（需 YYYY-MM-DD）：${opts.date}`)
    exit(1)
  }
  requireGeminiKeyOrExit('cd apps/server && pnpm exec tsx --env-file-if-exists=.env tools/cli/brief-rerun.ts --date <date> --out <dir>')

  // --replicates 越高越容易撞到 500 次／尖峰 10 的專案風險門檻（見 llm-run-estimates.ts）。
  enforceLlmRunBudget(estimateBriefRerun(opts.replicates), {
    confirmed: opts.yes === true,
    errLog: line => console.error(line),
    exit,
  })

  // 只載入一次（不是每個 replicate 各查一次 DB）——同一天的原版 brief 不會
  // 在這幾秒內變化，重複查詢只是浪費一次 DB 往返。
  const historicalAsOf = await loadHistoricalSeriesAsOf(opts.date)
  const notice = formatAsOfNotice(opts.date, historicalAsOf)
  if (historicalAsOf)
    console.log(notice)
  else
    console.warn(notice)

  let totalCostUsd = 0
  let totalLatencyMs = 0
  for (let i = 1; i <= opts.replicates; i++) {
    try {
      const meta = await generateReplicateToFiles(opts, i, historicalAsOf)
      totalCostUsd += meta.totalCostUsd
      totalLatencyMs += meta.totalLatencyMs
    }
    catch (err) {
      if (err instanceof RerunDirExistsError) {
        console.error(`[brief-rerun] ${err.message}（不覆蓋既有輸出）`)
        exit(1)
      }
      if (err instanceof RerunSkippedError) {
        console.error(`[brief-rerun] ${err.message}`)
        exit(2)
      }
      throw err
    }
  }

  console.log(`[brief-rerun] ${opts.date} × ${opts.replicates} replicate(s)：cost $${totalCostUsd.toFixed(4)}、耗時 ${(totalLatencyMs / 1000).toFixed(1)}s、輸出於 ${resolve(opts.out, opts.date)}`)
}

const program = new Command()
program
  .name('brief-rerun')
  .description('同素材重跑：用現在的 pipeline 重新產出某天的 brief，只寫檔案、絕不寫 DB（daily_briefs 由 saveDailyBrief upsert、會覆蓋原版）')
  .requiredOption('-d, --date <YYYY-MM-DD>', '要重跑的報告日（台北曆日）')
  .requiredOption('-o, --out <dir>', '輸出根目錄')
  .option('-l, --label <label>', '輸出子目錄標籤', 'rerun')
  .option('--replicates <n>', '重跑次數（每次各自成一個子目錄）', (v: string) => Number.parseInt(v, 10), 1)
  .option('--yes', '略過並行預算警告、強制執行（預估超過 500 次呼叫或尖峰超過 10 時需要）')
  .action((opts: RerunCliOpts) => run(opts).then(() => exit(0)).catch((err: Error) => {
    console.error(err.stack ?? err.message)
    exit(1)
  }))

// 只有直接執行時才跑 CLI parse；被 vitest import 純函式時不觸發（argv[1] 為 vitest binary、不相符）
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  program.parseAsync(process.argv).catch((err: Error) => {
    console.error(err.stack ?? err.message)
    exit(1)
  })
}
