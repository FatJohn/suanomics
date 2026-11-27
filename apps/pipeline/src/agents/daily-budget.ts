import type { DailyCostGateOptions } from './cost-gate.js'
import process from 'node:process'
import { dbLedger, getSpentTodayUsd } from '../db/repos/llm-calls-repo.js'
import { DailyCostGate, DailyCostLimitExceededError, installDailyCostGate, parseDailyCostLimit } from './cost-gate.js'

// 每個步驟各自一個 process，閘只看得到自己的花費；每日總上限要從帳本讀今天已花多少（#131）。
// 帳本寫不進去的呼叫不會被算到（cost-gate 會印 ::error），真正的硬上限仍是 Console 的 spend limit。

/**
 * 本步可花的額度：本步上限與今天剩下的總額取小。用完時回 0 或負數而不拋錯：
 * 建閘在 CLI 開頭，brief 已存在、已有音檔這類不呼叫 LLM 的略過路徑仍要 exit 0，由閘在第一次呼叫前擋。
 */
export function sharedCostLimit(p: { stepLimitUsd: number, dailyTotalUsd: number, spentTodayUsd: number }): number {
  return Math.min(p.stepLimitUsd, p.dailyTotalUsd - p.spentTodayUsd)
}

export async function createSharedDailyCostGate(p: {
  stepLimitUsd: number
  totalLimitRaw: string | undefined
  getSpentTodayUsd: () => Promise<number>
  gateOptions?: DailyCostGateOptions
  log?: (event: { event: 'shared_cost_limit', stepLimitUsd: number, dailyTotalUsd: number, spentTodayUsd: number, limitUsd: number }) => void
}): Promise<DailyCostGate> {
  const dailyTotalUsd = parseDailyCostLimit(p.totalLimitRaw, 'DAILY_TOTAL_COST_LIMIT_USD')
  const spentTodayUsd = await p.getSpentTodayUsd()
  const limitUsd = sharedCostLimit({ stepLimitUsd: p.stepLimitUsd, dailyTotalUsd, spentTodayUsd })
  p.log?.({ event: 'shared_cost_limit', stepLimitUsd: p.stepLimitUsd, dailyTotalUsd, spentTodayUsd, limitUsd })
  return new DailyCostGate(limitUsd, p.gateOptions)
}

/** 每日路徑的 CLI（corpus、daily、podcast）在第一次 LLM 呼叫前呼叫，裝成 process 共用的閘。 */
export async function installSharedDailyCostGate(): Promise<DailyCostGate> {
  const gate = await createSharedDailyCostGate({
    stepLimitUsd: parseDailyCostLimit(process.env.DAILY_COST_LIMIT_USD),
    totalLimitRaw: process.env.DAILY_TOTAL_COST_LIMIT_USD,
    getSpentTodayUsd,
    gateOptions: { ledger: dbLedger },
    log: event => console.warn(JSON.stringify(event)),
  })
  installDailyCostGate(gate)
  return gate
}

/** 不在每日路徑上的工作（judge）遇到總額用完時記成略過、不讓 workflow 失敗；其他錯誤照丟。 */
export async function skipWhenBudgetExhausted<T>(fn: () => Promise<T>): Promise<{ value: T } | undefined> {
  try {
    return { value: await fn() }
  }
  catch (error) {
    if (error instanceof DailyCostLimitExceededError)
      return undefined
    throw error
  }
}
