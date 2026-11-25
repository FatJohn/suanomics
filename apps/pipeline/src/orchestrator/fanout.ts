import pMap from 'p-map'
import { CostGateError, LlmAccountError } from '../agents/cost-gate.js'

export interface FanoutLimits { decomposer: number, retrieve: number, tier1: number, tier2: number }

export const FANOUT: FanoutLimits = { decomposer: 3, retrieve: 3, tier1: 3, tier2: 3 }

// decompose、retrieve、analyst 三階段循序；只有 analyst 內 tier1 worker 各自展開 tier2 會相乘。
export function effectiveLlmPeak(c: FanoutLimits): number {
  return Math.max(c.decomposer, c.retrieve, c.tier1 * c.tier2)
}

export type Settled<T> = { status: 'fulfilled', value: T } | { status: 'rejected', reason: unknown }

/** 單筆失敗不中斷整批；花費閘例外等在飛的工作收尾後才丟，避免它們在 DB 關閉後還跑。 */
export async function fanoutSettled<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<Settled<R>[]> {
  const settled = await pMap(items, async (item, index): Promise<Settled<R>> => {
    try {
      return { status: 'fulfilled', value: await fn(item, index) }
    }
    catch (reason) {
      return { status: 'rejected', reason }
    }
  }, { concurrency })
  const reasons = settled.flatMap(r => (r.status === 'rejected' ? [r.reason as unknown] : []))
  // 帳務錯誤優先：花費閘例外會走 incomplete 流程，帳務錯誤要讓 run 失敗。
  const fatal = reasons.find(e => e instanceof LlmAccountError) ?? reasons.find(e => e instanceof CostGateError)
  if (fatal !== undefined)
    throw fatal
  return settled
}
