import { describe, expect, it } from 'vitest'
import { createFixedWindowLimiter } from './rate-limit.js'

describe('createFixedWindowLimiter', () => {
  it('allows requests under the limit', () => {
    const limiter = createFixedWindowLimiter({ limit: 3, windowMs: 60_000, now: () => 0 })
    expect(limiter.check('a').allowed).toBe(true)
    expect(limiter.check('a').allowed).toBe(true)
    expect(limiter.check('a').allowed).toBe(true)
  })

  it('blocks requests once the limit is exceeded', () => {
    const limiter = createFixedWindowLimiter({ limit: 2, windowMs: 60_000, now: () => 0 })
    limiter.check('a')
    limiter.check('a')
    expect(limiter.check('a').allowed).toBe(false)
  })

  it('resets after the window elapses', () => {
    let currentTime = 0
    const limiter = createFixedWindowLimiter({ limit: 1, windowMs: 60_000, now: () => currentTime })
    expect(limiter.check('a').allowed).toBe(true)
    expect(limiter.check('a').allowed).toBe(false)
    currentTime = 60_000
    expect(limiter.check('a').allowed).toBe(true)
  })

  it('tracks separate keys independently', () => {
    const limiter = createFixedWindowLimiter({ limit: 1, windowMs: 60_000, now: () => 0 })
    expect(limiter.check('a').allowed).toBe(true)
    expect(limiter.check('b').allowed).toBe(true)
    expect(limiter.check('a').allowed).toBe(false)
  })

  it('disables the limiter entirely when limit is 0 or negative', () => {
    const zero = createFixedWindowLimiter({ limit: 0, windowMs: 60_000, now: () => 0 })
    for (let i = 0; i < 50; i++)
      expect(zero.check('a').allowed).toBe(true)

    const negative = createFixedWindowLimiter({ limit: -1, windowMs: 60_000, now: () => 0 })
    expect(negative.check('a').allowed).toBe(true)
  })

  it('reports retryAfterSec rounded up to the window end', () => {
    let currentTime = 0
    const limiter = createFixedWindowLimiter({ limit: 1, windowMs: 60_000, now: () => currentTime })
    limiter.check('a')
    currentTime = 10_000
    const result = limiter.check('a')
    expect(result.allowed).toBe(false)
    expect(result.retryAfterSec).toBe(50)
  })

  it('retryAfterSec is at least 1 even right at the window end', () => {
    let currentTime = 0
    const limiter = createFixedWindowLimiter({ limit: 1, windowMs: 1000, now: () => currentTime })
    limiter.check('a')
    currentTime = 999
    expect(limiter.check('a').retryAfterSec).toBeGreaterThanOrEqual(1)
  })

  it('evicts the oldest key once maxKeys is exceeded (no expired ones to clear first)', () => {
    const limiter = createFixedWindowLimiter({ limit: 1, windowMs: 60_000, now: () => 0, maxKeys: 2 })
    expect(limiter.check('a').allowed).toBe(true)
    expect(limiter.check('b').allowed).toBe(true)
    // 加入第三個 key 時已滿 2 個、都還沒過期 → 丟最舊的 'a'
    expect(limiter.check('c').allowed).toBe(true)
    // 'a' 的視窗紀錄已被清掉，重新 check 視為新視窗的第一次
    expect(limiter.check('a').allowed).toBe(true)
  })

  it('prefers clearing expired keys over evicting a live one', () => {
    let currentTime = 0
    const limiter = createFixedWindowLimiter({ limit: 1, windowMs: 1000, now: () => currentTime, maxKeys: 2 })
    expect(limiter.check('a').allowed).toBe(true)
    currentTime = 2000 // 'a' 的視窗已過期
    expect(limiter.check('b').allowed).toBe(true)
    // 加入第三個 key 時 'a' 已過期，先清過期的就夠、不必動還活著的 'b'
    expect(limiter.check('c').allowed).toBe(true)
    // 'b' 仍在視窗內，仍記得曾經 check 過一次
    expect(limiter.check('b').allowed).toBe(false)
  })
})
