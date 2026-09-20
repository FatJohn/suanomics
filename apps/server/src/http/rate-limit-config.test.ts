import { describe, expect, it } from 'vitest'
import { parseRateLimitEnvInt, resolveAnalyzeRateLimitConfig } from './rate-limit-config.js'

describe('parseRateLimitEnvInt', () => {
  it('uses the default when the value is undefined', () => {
    expect(parseRateLimitEnvInt(undefined, 5)).toBe(5)
  })

  it('uses the default when the value is empty or whitespace-only', () => {
    expect(parseRateLimitEnvInt('', 5)).toBe(5)
    expect(parseRateLimitEnvInt('   ', 5)).toBe(5)
  })

  it('uses the default when the value is not a number', () => {
    expect(parseRateLimitEnvInt('abc', 5)).toBe(5)
  })

  it('uses the default when the value is negative', () => {
    expect(parseRateLimitEnvInt('-1', 5)).toBe(5)
  })

  it('parses a valid positive integer', () => {
    expect(parseRateLimitEnvInt('10', 5)).toBe(10)
  })

  it('treats 0 as a valid value (disables the layer), not as invalid', () => {
    expect(parseRateLimitEnvInt('0', 5)).toBe(0)
  })

  it('floors a decimal value', () => {
    expect(parseRateLimitEnvInt('10.9', 5)).toBe(10)
  })
})

describe('resolveAnalyzeRateLimitConfig', () => {
  it('uses defaults when env vars are unset', () => {
    const config = resolveAnalyzeRateLimitConfig({})
    expect(config.perClientLimit).toBe(5)
    expect(config.perClientWindowMs).toBe(60_000)
    expect(config.globalLimit).toBe(60)
    expect(config.globalWindowMs).toBe(3_600_000)
  })

  it('reads overrides from env vars', () => {
    const config = resolveAnalyzeRateLimitConfig({
      ANALYZE_RATE_LIMIT_PER_CLIENT_PER_MIN: '10',
      ANALYZE_RATE_LIMIT_GLOBAL_PER_HOUR: '200',
    })
    expect(config.perClientLimit).toBe(10)
    expect(config.globalLimit).toBe(200)
  })

  it('falls back to defaults on invalid values', () => {
    const config = resolveAnalyzeRateLimitConfig({
      ANALYZE_RATE_LIMIT_PER_CLIENT_PER_MIN: 'not-a-number',
      ANALYZE_RATE_LIMIT_GLOBAL_PER_HOUR: '-5',
    })
    expect(config.perClientLimit).toBe(5)
    expect(config.globalLimit).toBe(60)
  })
})
