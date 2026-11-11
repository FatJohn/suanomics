import type { MarketBrief } from '@suanomics/shared'
import type { DailyCostGate } from '../agents/cost-gate.js'
import type { AnalystOutput, DecomposerOutput } from '../agents/types.js'
import type { RelevanceCandidate } from '../db/repos/news-repo.js'
import type { MarketContext } from '../ingest/market-data/context.js'
import type { EditorStageResult } from './editor-stage.js'
import type { GenerateBriefParams } from './run-brief.js'
import { DailyCostLimitExceededError } from '../agents/cost-gate.js'

export type StageName = 'ingest' | 'market-context' | 'editor' | 'decompose' | 'retrieve' | 'analyst' | 'synthesize' | 'finalize' | 'persist'

export type RunStage = <T>(name: StageName, run: () => Promise<T>) => Promise<T>

export type DailyLogEvent
  = | { event: 'stage_start', stage: StageName }
    | { event: 'stage_end', stage: StageName, ok: boolean, durationMs: number, calls: number, usd: number }
    | { event: 'storylines_failed', message: string }
    | { event: 'storylines_new_skipped', date: string, count: number }
    | { event: 'run_end', date: string, status: DailyResult['status'], calls: number, usd: number }
    | { event: 'non_trading_refresh', date: string, inserted: number, calls: number, usd: number }

/** 花費閘觸發時寫進 `daily_briefs.progress` 的內容，讓已花錢的產出不會遺失。 */
export interface DailyProgress {
  completedStages: StageName[]
  failedStage?: StageName
  editor?: EditorStageResult
  decomposed?: { newsId: string, decomposed: DecomposerOutput }[]
  // tier2 尚未完成的新聞，這裡只有 tier1 的 chains。
  analystOutputs?: AnalystOutput[]
  brief?: MarketBrief
  // finalize 三個呼叫各自成功的結果。
  finalize?: { viewpoints?: unknown, narrative?: unknown, groupedChains?: unknown }
}

export type DailyResult
  = | { status: 'skipped', reason: 'non-trading-day' | 'already-exists', date: string }
    | { status: 'complete', date: string, briefId: number }
    | { status: 'incomplete', date: string, failedStage: StageName }

export interface DailyDeps {
  gate: Pick<DailyCostGate, 'totalUsd' | 'callCount' | 'setReportDate'>
  log: (event: DailyLogEvent) => void
  isTradingDay: (date: string) => boolean
  findExistingBrief: (date: string) => Promise<{ status: string } | null>
  // 只抓新聞進候選池，回傳新增則數。
  refreshNews: () => Promise<number>
  hasCompleteBriefOnOrAfter: (date: string) => Promise<boolean>
  ingest: (date: string) => Promise<RelevanceCandidate[]>
  loadMarket: (date: string) => Promise<MarketContext>
  selectNews: (date: string, selected: RelevanceCandidate[], market: MarketContext) => Promise<EditorStageResult>
  generateBrief: (p: GenerateBriefParams) => Promise<MarketBrief>
  saveBrief: (date: string, newsIds: number[], summary: string, brief: MarketBrief) => Promise<number>
  saveIncompleteBrief: (date: string, newsIds: number[], progress: DailyProgress) => Promise<void>
  applyStorylines: (date: string, storyline: NonNullable<EditorStageResult['storyline']>) => Promise<void>
}

function roundUsd(usd: number): number {
  return Number(usd.toFixed(6))
}

function createStageRunner(deps: DailyDeps, progress: DailyProgress): RunStage {
  return async (stage, run) => {
    const startedAt = Date.now()
    const callsBefore = deps.gate.callCount
    const usdBefore = deps.gate.totalUsd
    const end = (ok: boolean): void => deps.log({
      event: 'stage_end',
      stage,
      ok,
      durationMs: Date.now() - startedAt,
      calls: deps.gate.callCount - callsBefore,
      usd: roundUsd(deps.gate.totalUsd - usdBefore),
    })
    deps.log({ event: 'stage_start', stage })
    try {
      const result = await run()
      progress.completedStages.push(stage)
      end(true)
      return result
    }
    catch (err) {
      progress.failedStage = stage
      end(false)
      throw err
    }
  }
}

async function runStages(date: string, isRerun: boolean, deps: DailyDeps, progress: DailyProgress, stage: RunStage): Promise<number> {
  const selected = await stage('ingest', () => deps.ingest(date))
  const market = await stage('market-context', () => deps.loadMarket(date))
  const editor = await stage('editor', () => deps.selectNews(date, selected, market))
  progress.editor = editor
  if (editor.news.length === 0)
    throw new Error(`${date} 沒有可用的新聞`)

  const brief = await deps.generateBrief({ date, news: editor.news, market, editor, stage, progress })
  const newsIds = editor.news.map(n => n.id)
  const briefId = await stage('persist', () => deps.saveBrief(date, newsIds, `${brief.headline}\n\n${brief.summary}`, brief))

  // 要在 brief 寫入之後：updates 的 briefDate 要對應已存在的 brief。寫回失敗下次 editor 會看到舊狀態自癒。
  if (editor.storyline) {
    try {
      // 新建沒有冪等鍵：重跑時 editor 換個標題就多一條線。touches 與 resolves 只保證同線同日不疊加，照常寫回。
      if (isRerun && editor.storyline.newStorylines.length > 0)
        deps.log({ event: 'storylines_new_skipped', date, count: editor.storyline.newStorylines.length })
      await deps.applyStorylines(date, isRerun ? { ...editor.storyline, newStorylines: [] } : editor.storyline)
    }
    catch (err) {
      deps.log({ event: 'storylines_failed', message: err instanceof Error ? err.message : String(err) })
    }
  }
  return briefId
}

export async function runDaily(options: { date: string, force: boolean }, deps: DailyDeps): Promise<DailyResult> {
  const { date, force } = options
  if (!deps.isTradingDay(date)) {
    // 只保留最新幾則的 feed 撐不到下一個交易日，休市期間的新聞當天就要進候選池。
    deps.gate.setReportDate(date)
    const inserted = await deps.refreshNews()
    deps.log({ event: 'non_trading_refresh', date, inserted, calls: deps.gate.callCount, usd: roundUsd(deps.gate.totalUsd) })
    return { status: 'skipped', reason: 'non-trading-day', date }
  }
  // incomplete 也算已存在：備援排程再跑一次會讓當日花費上限實質翻倍，重跑要明確帶 --force。
  if (!force && await deps.findExistingBrief(date))
    return { status: 'skipped', reason: 'already-exists', date }

  deps.gate.setReportDate(date)
  // 要在寫入 brief 之前判定，否則每次都會看到自己剛寫的那份。
  const isRerun = await deps.hasCompleteBriefOnOrAfter(date)
  const progress: DailyProgress = { completedStages: [] }
  const finish = <T extends DailyResult>(result: T): T => {
    deps.log({ event: 'run_end', date, status: result.status, calls: deps.gate.callCount, usd: roundUsd(deps.gate.totalUsd) })
    return result
  }
  try {
    const briefId = await runStages(date, isRerun, deps, progress, createStageRunner(deps, progress))
    return finish({ status: 'complete', date, briefId })
  }
  catch (err) {
    if (!(err instanceof DailyCostLimitExceededError) || progress.failedStage === undefined)
      throw err
    await deps.saveIncompleteBrief(date, progress.editor?.news.map(n => n.id) ?? [], progress)
    return finish({ status: 'incomplete', date, failedStage: progress.failedStage })
  }
}
