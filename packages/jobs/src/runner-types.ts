import type { z } from 'zod'
import type { AuditRepo } from './audit.js'
import type { EnqueueResult, JobKind, JobPayloadByKind, PAYLOAD_SCHEMA_BY_KIND } from './types.js'

// 呼叫端傳的是 schema 的 input（可省略 default 欄位）、解析後才變成 output。
// export 出去是因為它就是 enqueue 的參數型別：HTTP route 這類泛型轉發者要標得出
// 「我要傳給 enqueue 的東西是什麼型別」，沒有它就只能 cast 成 output 型別蒙混。
export type RawPayloadByKind = {
  [K in JobKind]: z.input<(typeof PAYLOAD_SCHEMA_BY_KIND)[K]>
}

export type EnqueueFn = <K extends JobKind>(kind: K, rawPayload: RawPayloadByKind[K]) => Promise<EnqueueResult>

export interface JobCtx {
  auditId: string
  /** 1-based：第一次執行是 1，重試才是 2、3。 */
  attempt: number
  updateProgress: (percent: number, stage?: string) => Promise<void>
  markMetadata: (partial: Record<string, unknown>) => Promise<void>
  /** chain／fan-out 用。handler 不從 module 匯入 enqueue 單例，才能被注入與測試。 */
  enqueue: EnqueueFn
}

export interface JobOutcome {
  resultRef: string
  metadata?: Record<string, unknown>
}

export type JobHandler<K extends JobKind> = (payload: JobPayloadByKind[K], ctx: JobCtx) => Promise<JobOutcome>

export interface JobSpec {
  kind: JobKind
  concurrency: number
}

/** runner 真正用到的 audit 能力。窄化成這幾支，是為了讓測試不必造整個 AuditRepo。 */
export type RunnerAuditRepo = Pick<
  AuditRepo,
  'insert' | 'markActive' | 'markCompleted' | 'markFailed' | 'markMetadata' | 'findInflight' | 'findRecentCompleted'
>

export interface JobRunnerOptions {
  audit: RunnerAuditRepo
  specs: readonly JobSpec[]
  /** Record 型別：漏一個 kind 是編譯錯誤，不是「那個 kind 靜靜沒有人消費」。 */
  handlers: { [K in JobKind]: JobHandler<K> }
  /** 第 n 次失敗後等 backoffMs * 2^(n-1)。預設見 JOB_RETRY_DEFAULTS（3 次、5s 起）。 */
  retry?: { attempts: number, backoffMs: number }
  /** 測試注入；正式路徑用 setTimeout。 */
  sleep?: (ms: number) => Promise<void>
  log?: Pick<Console, 'warn' | 'error'>
}

export interface JobRunnerStats {
  pending: number
  waiting: number
  active: number
}

export interface JobRunner {
  enqueue: EnqueueFn
  start: () => void
  /** 不再啟動新 job，等 active 至多 timeoutMs（預設 30s）。backoff 中的 entry 不等、也不重跑。 */
  stop: (opts?: { timeoutMs?: number }) => Promise<void>
  /** 所有 kind 的 pending、waiting 與 active 三者都為 0 才 resolve（含執行中 enqueue 的 chain）。 */
  drain: () => Promise<void>
  stats: () => Record<JobKind, JobRunnerStats>
}
