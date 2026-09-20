import { describe, expect, it } from 'vitest'
import { readingProgress } from './reading-progress.js'

describe('readingProgress', () => {
  it('is 0 at the top', () => {
    expect(readingProgress(0, 800, 3000)).toBe(0)
  })
  it('is 1 when the last pixel of the document is on screen', () => {
    expect(readingProgress(2200, 800, 3000)).toBe(1)
  })
  it('is half way when half the scrollable distance is consumed', () => {
    expect(readingProgress(1100, 800, 3000)).toBeCloseTo(0.5)
  })
  it('clamps overscroll (iOS rubber-band gives scrollY > max)', () => {
    expect(readingProgress(4000, 800, 3000)).toBe(1)
    expect(readingProgress(-120, 800, 3000)).toBe(0)
  })
  it('is 1 when the document is shorter than the viewport (nothing to scroll)', () => {
    // 除以零的入口：文件比視窗短時 scrollable = 0
    expect(readingProgress(0, 800, 600)).toBe(1)
    expect(readingProgress(0, 800, 800)).toBe(1)
  })
})
