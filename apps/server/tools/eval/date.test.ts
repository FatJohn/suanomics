import { describe, expect, it } from 'vitest'
import { isValidEvalDate } from './date.js'

describe('isValidEvalDate', () => {
  it('accepts a well-formed YYYY-MM-DD date', () => {
    expect(isValidEvalDate('2026-06-16')).toBe(true)
  })
  it('rejects a malformed date string', () => {
    expect(isValidEvalDate('bad-format')).toBe(false)
  })
  it('rejects short-form dates without zero padding', () => {
    expect(isValidEvalDate('2026-6-1')).toBe(false)
  })
  it('rejects an out-of-range month', () => {
    expect(isValidEvalDate('2026-13-99')).toBe(false)
  })
  it('rejects an out-of-range day', () => {
    expect(isValidEvalDate('2026-02-30')).toBe(false)
  })
  it('accepts a valid leap-day', () => {
    expect(isValidEvalDate('2024-02-29')).toBe(true)
  })
})
