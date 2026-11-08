import process from 'node:process'

/** 花費閘的錯誤一律要讓 pipeline 停下，agent 的降級 catch 必須往外丟。 */
export class CostGateError extends Error {}

export class DailyCostLimitExceededError extends CostGateError {
  constructor(readonly limitUsd: number, readonly spentUsd: number) {
    super(`每日花費已超過上限：累計 $${spentUsd.toFixed(4)}，上限 $${limitUsd.toFixed(4)}`)
    this.name = 'DailyCostLimitExceededError'
  }
}

// 只在呼叫前檢查：單次呼叫與並行中的呼叫可能讓累計值略超過上限，
// 真正的硬上限是 Anthropic Console 的 workspace spend limit。
export class DailyCostGate {
  private spentUsd = 0
  private calls = 0

  constructor(private readonly limitUsd: number) {}

  get totalUsd(): number {
    return this.spentUsd
  }

  get callCount(): number {
    return this.calls
  }

  assertWithinLimit(): void {
    if (this.spentUsd > this.limitUsd)
      throw new DailyCostLimitExceededError(this.limitUsd, this.spentUsd)
  }

  record(costUsd: number): void {
    this.spentUsd += costUsd
    this.calls += 1
  }
}

export function parseDailyCostLimit(raw: string | undefined): number {
  const limit = Number(raw)
  if (raw === undefined || raw === '' || !Number.isFinite(limit) || limit <= 0)
    throw new CostGateError(`DAILY_COST_LIMIT_USD 必須是正數，收到 ${raw ?? '（未設定）'}`)
  return limit
}

let processGate: DailyCostGate | undefined

/** 整個 process 共用一個閘；沒設上限時拒絕執行，不退回「不設限」。 */
export function getDailyCostGate(): DailyCostGate {
  processGate ??= new DailyCostGate(parseDailyCostLimit(process.env.DAILY_COST_LIMIT_USD))
  return processGate
}
