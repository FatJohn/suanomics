import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import { concatPcmSegments, DEFAULT_GAP_MS } from './pcm-concat.js'

describe('concatPcmSegments', () => {
  it('段間插 zero-fill 靜音、總長 = Σ段 + (n-1)×gap bytes', () => {
    // sampleRate=1000, gapMs=2 → gapSamples=2 → gapBytes=4（mono 16-bit）
    const a = Buffer.from([0x01, 0x02])
    const b = Buffer.from([0x03, 0x04])
    const out = concatPcmSegments([a, b], { sampleRate: 1000, gapMs: 2 })
    expect(out.length).toBe(2 + 4 + 2)
    expect(out.subarray(0, 2).equals(a)).toBe(true)
    expect(out.subarray(2, 6).equals(Buffer.alloc(4))).toBe(true) // gap 全為 0
    expect(out.subarray(6, 8).equals(b)).toBe(true)
  })

  it('單段時不加 gap', () => {
    const a = Buffer.from([0x01, 0x02])
    expect(concatPcmSegments([a], { sampleRate: 1000, gapMs: 2 }).length).toBe(2)
  })

  it('dEFAULT_GAP_MS 為 150', () => {
    expect(DEFAULT_GAP_MS).toBe(150)
  })
})
