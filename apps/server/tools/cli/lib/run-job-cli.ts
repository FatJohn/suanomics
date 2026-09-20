/* eslint-disable no-console -- CLI 進度輸出 */
import type { EnqueueResult, JobKind, RawPayloadByKind } from '@suanomics/jobs'
import process from 'node:process'
import { createAuditRepo } from '@suanomics/jobs'
import { createServerRunner } from '../../../src/jobs/create-server-runner.js'

export const DEFAULT_CLI_TIMEOUT_MS = 1_200_000

/**
 * 解析所有 CLI 共用的 `--timeout=N`（秒）。
 *
 * `--wait` 不再存在：以前 CLI 只是把 job 丟進 queue、要另外起一個常駐 worker 才有人跑，
 * 所以「要不要等」是個選擇。現在 CLI 自己就是那個 worker，不等於什麼都沒做。
 */
export function parseTimeoutMs(argv: readonly string[], fallbackMs = DEFAULT_CLI_TIMEOUT_MS): number {
  for (const a of argv) {
    if (a?.startsWith('--timeout=')) {
      const s = Number.parseInt(a.split('=')[1] ?? '', 10)
      if (Number.isFinite(s) && s > 0)
        return s * 1000
    }
  }
  return fallbackMs
}

export interface RunJobCliOpts<K extends JobKind> {
  kind: K
  payload: RawPayloadByKind[K]
  timeoutMs: number
  /** 進 enqueue 之前印的那一行。 */
  label: string
}

/**
 * CLI 的共同骨架：起 runner、enqueue、跑到所有 kind 都空（含 chain）才退出。
 *
 * 退出碼：0 完成、1 失敗、124 逾時。`already-inflight`／`already-completed` 一律 exit 0
 * （另一個 process 正在跑或今天已經跑過，與從前一致）。
 */
export async function runJobCli<K extends JobKind>(opts: RunJobCliOpts<K>): Promise<never> {
  const runner = createServerRunner()
  runner.start()
  console.log(opts.label)
  let result: EnqueueResult
  try {
    result = await runner.enqueue(opts.kind, opts.payload)
  }
  catch (err) {
    console.error(`[${opts.kind}] enqueue failed:`, err)
    return process.exit(1)
  }
  console.log(JSON.stringify(result, null, 2))
  if (result.status !== 'queued')
    return process.exit(0)

  const TIMED_OUT = Symbol('timed-out')
  let timer: ReturnType<typeof setTimeout> | undefined
  const outcome = await Promise.race([
    runner.drain(),
    new Promise<typeof TIMED_OUT>((res) => {
      timer = setTimeout(res, opts.timeoutMs, TIMED_OUT)
    }),
  ])
  if (timer !== undefined)
    clearTimeout(timer)
  if (outcome === TIMED_OUT) {
    console.error(`[${opts.kind}] timed out after ${opts.timeoutMs}ms`)
    return process.exit(124)
  }

  const row = await createAuditRepo().findById(result.auditId)
  console.log(`[${opts.kind}] status=${row?.status ?? 'unknown'} resultRef=${row?.resultRef ?? 'null'}`)
  if (row?.status === 'completed')
    return process.exit(0)
  console.error(`[${opts.kind}] error=${row?.errorMessage ?? 'unknown'}`)
  return process.exit(1)
}
