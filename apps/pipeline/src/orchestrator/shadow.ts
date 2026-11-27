import type { MarketBrief } from '@suanomics/shared'
import type { ShadowSource } from '../db/repos/shadow-briefs-repo.js'
import type { BriefRunInputs, DailyDeps, DailyProgress } from './daily.js'
import type { GenerateBriefParams } from './run-brief.js'
import { CostGateError } from '../agents/cost-gate.js'
import { runInputsHash } from '../db/repos/shadow-briefs-repo.js'
import { createStageRunner } from './daily.js'

// A/B 對照組：同一份輸入關掉 corpus 檢索。
export const NO_CORPUS_VARIANT = 'no-corpus'

export interface ShadowDeps extends Pick<DailyDeps, 'gate' | 'log'> {
  getSource: (date: string) => Promise<ShadowSource | null>
  getExisting: (date: string, variant: string) => Promise<{ id: number, inputsHash: string } | null>
  generateBrief: (p: GenerateBriefParams) => Promise<MarketBrief>
  saveShadow: (date: string, variant: string, newsIds: number[], brief: MarketBrief, inputsHash: string) => Promise<number>
}

export type ShadowResult
  = | { status: 'skipped', reason: 'already-exists', date: string }
    | { status: 'complete', date: string, shadowId: number }

/**
 * 影子報告的花費閘上限：每日上限扣掉今天帳本已花的金額。每個 process 的閘只算自己，
 * 不扣的話正式報告花完之後再跑影子，當日合計可到上限的兩倍。
 */
export function shadowCostLimit(dailyLimitUsd: number, spentTodayUsd: number): number {
  const headroom = dailyLimitUsd - spentTodayUsd
  if (headroom <= 0)
    throw new CostGateError(`今天已花 $${spentTodayUsd.toFixed(4)}，達每日上限 $${dailyLimitUsd.toFixed(4)}，不跑影子報告`)
  return headroom
}

/**
 * 影子報告要和正式報告同一套功能開關與 model，A/B 才只差 corpus。daily.yml 的 Run pipeline 設了這兩個，
 * 本機跑影子漏帶時 analyst 不產 claim、claim ledger 為空，整份影子不能比（2026-11-19 實際發生）。
 */
const DAILY_FEATURE_FLAGS = ['ANALYST_CLAIMS_ENABLED', 'NARRATIVE_LEDGER_ENABLED'] as const

export function requireDailyFeatureFlags(env: Record<string, string | undefined>): void {
  const missing = DAILY_FEATURE_FLAGS.filter(name => env[name] !== 'true')
  if (missing.length > 0)
    throw new Error(`影子報告要與 daily.yml 同設定，${missing.join('、')} 須為 true`)
  // daily.yml 沒設 AGENT_MODELS，正式報告用預設 model；本機 .env 留著舊實驗的覆寫會讓兩臂差在 model。
  if (env.AGENT_MODELS)
    throw new Error('影子報告要與 daily.yml 同設定，AGENT_MODELS 須未設定')
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

// 只擋得到「沒存或存的是別版」：內容是 daily 自己寫的，逐欄驗等於再寫一份 MarketContext 的 schema。
export function parseRunInputs(date: string, raw: unknown): BriefRunInputs {
  if (!isObject(raw) || raw.version !== 1 || !isObject(raw.editor) || !Array.isArray(raw.editor.news) || !isObject(raw.market))
    throw new Error(`${date} 的 run_inputs 缺少或格式不符（version 1），這天的正式報告早於 run_inputs 上線或不是 complete 重跑產生`)
  return raw as unknown as BriefRunInputs
}

export async function runShadow(options: { date: string, force: boolean }, deps: ShadowDeps): Promise<ShadowResult> {
  const { date, force } = options
  const source = await deps.getSource(date)
  if (source === null)
    throw new Error(`${date} 沒有 complete 的正式報告`)
  const inputs = parseRunInputs(date, source.runInputs)
  const inputsHash = runInputsHash(source.runInputs)
  // 舊影子是另一份輸入產的（正式報告後來 --force 重跑過）就不算已存在。
  if (!force && (await deps.getExisting(date, NO_CORPUS_VARIANT))?.inputsHash === inputsHash)
    return { status: 'skipped', reason: 'already-exists', date }

  deps.gate.setReportDate(date)
  // 花費閘觸發就整份放棄：影子報告不發佈，沒有保留半成品的理由。
  const progress: DailyProgress = { completedStages: [] }
  const brief = await deps.generateBrief({
    date,
    news: inputs.editor.news,
    market: inputs.market,
    editor: { ...inputs.editor, storyline: null },
    stage: createStageRunner(deps, progress),
    progress,
    retrieveCorpus: false,
  })
  const shadowId = await deps.saveShadow(date, NO_CORPUS_VARIANT, inputs.editor.news.map(n => n.id), brief, inputsHash)
  return { status: 'complete', date, shadowId }
}
