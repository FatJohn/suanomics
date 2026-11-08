import { describe, expect, it } from 'vitest'
import { applySpread, applyTransform } from './transform.js'

const M = (date: string, value: number) => ({ date, value })

describe('applyTransform', () => {
  it('level: identity', () => {
    expect(applyTransform('level', [M('2026-06-11', 4.32)])).toEqual([M('2026-06-11', 4.32)])
  })
  it('yoy: (curr/prev12m - 1) * 100, skips points without a 12m-ago match', () => {
    const out = applyTransform('yoy', [M('2025-05-01', 100), M('2026-05-01', 103.1)])
    expect(out).toHaveLength(1)
    expect(out[0]?.date).toBe('2026-05-01')
    expect(out[0]?.value).toBeCloseTo(3.1)
  })
  it('mom-diff: current minus previous point', () => {
    const out = applyTransform('mom-diff', [M('2026-04-01', 159_000), M('2026-05-01', 159_185)])
    expect(out).toEqual([M('2026-05-01', 185)])
  })
  // mom-diff 的語意是「跟上一個現有點比」、不是「跟日曆上一個月比」。
  // 對 FRED 月頻資料這是 OK 的：即使中間缺一個月、仍以相鄰兩個現有點算 diff。
  it('mom-diff: diffs against the previous existing point even across a gap', () => {
    const out = applyTransform('mom-diff', [M('2026-03-01', 100), M('2026-05-01', 130)])
    expect(out).toEqual([M('2026-05-01', 30)])
  })
})

describe('applySpread', () => {
  it('joins on date, a - b, skips unmatched dates', () => {
    const out = applySpread(
      [M('2026-06-11', 4.32), M('2026-06-10', 4.28)],
      [M('2026-06-11', 3.87)],
    )
    expect(out).toHaveLength(1)
    expect(out[0]?.date).toBe('2026-06-11')
    expect(out[0]?.value).toBeCloseTo(0.45)
  })
})
