import { randomUUID } from 'node:crypto'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'
import { taipeiDateOf } from '@suanomics/shared'
import { dbLedger } from '../db/repos/llm-calls-repo.js'

/** 花費閘與帳務錯誤一律要讓 pipeline 停下，agent 的降級 catch 必須往外丟。 */
export class CostGateError extends Error {}

export class DailyCostLimitExceededError extends CostGateError {
  constructor(readonly limitUsd: number, readonly spentUsd: number) {
    super(`每日花費已超過上限：累計 $${spentUsd.toFixed(4)}，上限 $${limitUsd.toFixed(4)}`)
    this.name = 'DailyCostLimitExceededError'
  }
}

/** 額度、帳務或認證問題：重試與降級都救不了，繼續跑只會產出殘缺報告。 */
export class LlmAccountError extends CostGateError {
  constructor(message: string) {
    super(message)
    this.name = 'LlmAccountError'
  }
}

export type LlmCallStatus = 'ok' | 'invalid_output' | 'failed'

/** 一次 LLM 呼叫的帳。四種 token 互斥，合起來才是總輸入輸出；`costUsd` 為 null 表示金額未知或地端。 */
export interface LlmCallEntry {
  agent: string
  newsId?: string
  provider: string
  model: string
  tokensIn: number
  tokensOut: number
  cacheReadTokens: number
  cacheWriteTokens: number
  latencyMs: number
  attempts: number
  status: LlmCallStatus
  costUsd: number | null
  priceVersion: string
}

export interface LlmLedgerRow extends LlmCallEntry {
  id: string
  runId: string
  reportDate: string
}

export interface LlmLedger {
  insert: (row: LlmLedgerRow) => Promise<void>
}

interface DailyCostGateOptions {
  ledger?: LlmLedger
  runId?: string
  retryDelayMs?: number
}

const LEDGER_WRITE_ATTEMPTS = 3
const DEFAULT_LEDGER_RETRY_DELAY_MS = 200

let processRunId: string | undefined

/** Actions 的重跑（run attempt）是另一次花費，要分開記。 */
export function currentRunId(): string {
  processRunId ??= process.env.GITHUB_RUN_ID
    ? `gh-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT ?? '1'}`
    : `local-${randomUUID()}`
  return processRunId
}

// 只在呼叫前檢查：單次呼叫與並行中的呼叫可能讓累計值略超過上限，
// 真正的硬上限是 Anthropic Console 的 workspace spend limit。
export class DailyCostGate {
  private spentUsd = 0
  private calls = 0
  private reportDate = taipeiDateOf(new Date())
  private readonly ledger: LlmLedger | undefined
  private readonly runId: string
  private readonly retryDelayMs: number

  constructor(private readonly limitUsd: number, options: DailyCostGateOptions = {}) {
    this.ledger = options.ledger
    this.runId = options.runId ?? currentRunId()
    this.retryDelayMs = options.retryDelayMs ?? DEFAULT_LEDGER_RETRY_DELAY_MS
  }

  /** 補跑舊日期時帳本的 report_date 要是該報告日，不是執行當天。 */
  setReportDate(date: string): void {
    this.reportDate = date
  }

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

  /**
   * 累計並寫帳本，寫進去才返回。
   * 重試用同一個 id：連線在 commit 後才斷時，第二次寫入由 DB 去重。
   * 重試用盡不擋 run：閘不讀帳本，帳本是事後查帳用，為它丟掉已付費的報告不划算。
   * 但不能默默漏：整列印到 stderr 可手動補回，annotation 會顯示在 run 的 Summary 頁。
   */
  async recordCall(entry: LlmCallEntry): Promise<void> {
    this.record(entry.costUsd ?? 0)
    if (!this.ledger)
      return
    const row: LlmLedgerRow = { ...entry, id: randomUUID(), runId: this.runId, reportDate: this.reportDate }
    let lastError: unknown
    for (let attempt = 1; attempt <= LEDGER_WRITE_ATTEMPTS; attempt++) {
      try {
        await this.ledger.insert(row)
        return
      }
      catch (error) {
        lastError = error
        if (attempt < LEDGER_WRITE_ATTEMPTS)
          await delay(this.retryDelayMs * attempt)
      }
    }
    console.error(`::error title=llm_calls 漏帳::${row.agent} 的一筆用量寫不進帳本（${lastError instanceof Error ? lastError.message : String(lastError)}）`)
    console.error(JSON.stringify({ event: 'llm_ledger_write_failed', row }))
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
  processGate ??= new DailyCostGate(parseDailyCostLimit(process.env.DAILY_COST_LIMIT_USD), { ledger: dbLedger })
  return processGate
}
