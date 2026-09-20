import { describe, expect, it } from 'vitest'
import { computeSegmentTimecodes } from './segment-timecodes.js'

describe('computeSegmentTimecodes', () => {
  it('由各段 PCM bytes + 段間 gap 累積出 start/duration（ms）', () => {
    // mono 16-bit、sampleRate=1000：2000 bytes=1000 samples=1000ms；4000 bytes=2000ms
    const tc = computeSegmentTimecodes([2000, 4000], { sampleRate: 1000, gapMs: 150 })
    expect(tc).toEqual([
      { startMs: 0, durationMs: 1000 },
      { startMs: 1150, durationMs: 2000 }, // 1000 + gap 150
    ])
  })

  it('單段 start 為 0', () => {
    expect(computeSegmentTimecodes([2000], { sampleRate: 1000, gapMs: 150 }))
      .toEqual([{ startMs: 0, durationMs: 1000 }])
  })
})
