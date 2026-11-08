import { describe, expect, it } from 'vitest'
import { findConsecutiveFailures, formatSourceAlert } from './source-failure-alert.js'

function day(n: number, failed: boolean, httpStatus: number | null = null) {
  return { runDate: `2026-11-0${n}`, failed, httpStatus }
}

describe('findConsecutiveFailures', () => {
  it('最近連續失敗達門檻才告警，並帶最新狀態碼', () => {
    const out = findConsecutiveFailures(new Map([['a', [day(3, true, 403), day(2, true, 403), day(1, true, 500)]]]), 3)
    expect(out).toEqual([{ slug: 'a', consecutive: 3, httpStatus: 403 }])
  })

  it('未達門檻不告警', () => {
    expect(findConsecutiveFailures(new Map([['a', [day(2, true), day(1, true)]]]), 3)).toEqual([])
  })

  it('中間有成功就重新計算', () => {
    expect(findConsecutiveFailures(new Map([['a', [day(4, true), day(3, false), day(2, true), day(1, true)]]]), 3)).toEqual([])
  })

  it('最新一次成功不告警', () => {
    expect(findConsecutiveFailures(new Map([['a', [day(4, false), day(3, true), day(2, true), day(1, true)]]]), 3)).toEqual([])
  })
})

describe('formatSourceAlert', () => {
  it('輸出 GitHub Actions annotation，連線失敗顯示無狀態碼', () => {
    expect(formatSourceAlert({ slug: 'a', consecutive: 3, httpStatus: null })).toBe('::warning title=新聞來源連續失敗::a 連續 3 天失敗（無狀態碼）')
    expect(formatSourceAlert({ slug: 'b', consecutive: 4, httpStatus: 403 })).toBe('::warning title=新聞來源連續失敗::b 連續 4 天失敗（HTTP 403）')
  })
})
