import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

type LogLevel = 'info' | 'warn' | 'error'

export interface LoggerOptions {
  runId: string
  runDir: string
}

export interface RunStats {
  totalTokensIn: number
  totalTokensOut: number
  totalCostUsd: number
  retryCount: number
  eventCount: number
}

export interface Logger {
  emit: (event: string, data?: Record<string, unknown>, level?: LogLevel) => void
  stats: () => RunStats
  close: () => void
}

export function createLogger(opts: LoggerOptions): Logger {
  mkdirSync(opts.runDir, { recursive: true })
  const jsonlPath = join(opts.runDir, 'run-log.jsonl')

  const s: RunStats = {
    totalTokensIn: 0,
    totalTokensOut: 0,
    totalCostUsd: 0,
    retryCount: 0,
    eventCount: 0,
  }

  function emit(event: string, data: Record<string, unknown> = {}, level: LogLevel = 'info') {
    const record = {
      ts: new Date().toISOString(),
      level,
      run_id: opts.runId,
      event,
      ...data,
    }
    appendFileSync(jsonlPath, `${JSON.stringify(record)}\n`, 'utf8')

    if (typeof data.tokens_in === 'number')
      s.totalTokensIn += data.tokens_in
    if (typeof data.tokens_out === 'number')
      s.totalTokensOut += data.tokens_out
    if (typeof data.cost_usd === 'number')
      s.totalCostUsd += data.cost_usd
    if (event === 'retry')
      s.retryCount += 1
    s.eventCount += 1

    const prefix = level === 'info' ? '' : `[${level}] `
    const dataStr = Object.entries(data).map(([k, v]) => `${k}=${v}`).join(' ')
    process.stdout.write(`${prefix}${event} ${dataStr}\n`)
  }

  function stats(): RunStats {
    return { ...s }
  }
  function close() { /* appendFileSync is sync, nothing to flush */ }

  return { emit, stats, close }
}
