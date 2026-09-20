import process from 'node:process'

export interface AnalyzeRateLimitConfig {
  perClientLimit: number
  perClientWindowMs: number
  globalLimit: number
  globalWindowMs: number
}

const PER_CLIENT_WINDOW_MS = 60_000
const GLOBAL_WINDOW_MS = 60 * 60_000

const DEFAULT_PER_CLIENT_LIMIT = 5
const DEFAULT_GLOBAL_LIMIT = 60

/**
 * 解析限流用的環境變數：非數字或負數一律退回預設值；`0` 是合法值（代表停用
 * 該層，見 rate-limit.ts 的 `createFixedWindowLimiter`），不當成無效值處理。
 * 小數無條件捨去——限流的「次數」沒有小數的意義。
 */
export function parseRateLimitEnvInt(value: string | undefined, defaultValue: number): number {
  const trimmed = value?.trim()
  if (!trimmed)
    return defaultValue
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed) || parsed < 0)
    return defaultValue
  return Math.floor(parsed)
}

export function resolveAnalyzeRateLimitConfig(env: NodeJS.ProcessEnv = process.env): AnalyzeRateLimitConfig {
  return {
    perClientLimit: parseRateLimitEnvInt(env.ANALYZE_RATE_LIMIT_PER_CLIENT_PER_MIN, DEFAULT_PER_CLIENT_LIMIT),
    perClientWindowMs: PER_CLIENT_WINDOW_MS,
    globalLimit: parseRateLimitEnvInt(env.ANALYZE_RATE_LIMIT_GLOBAL_PER_HOUR, DEFAULT_GLOBAL_LIMIT),
    globalWindowMs: GLOBAL_WINDOW_MS,
  }
}
