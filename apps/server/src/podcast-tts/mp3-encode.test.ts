import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import { DEFAULT_MP3_BITRATE_KBPS, encodeMp3 } from './mp3-encode.js'

// 從 MP3 第一個 frame header 讀聲道模式：0=stereo 1=joint 2=dual 3=mono
function firstFrameChannelMode(mp3: Buffer): number {
  for (let i = 0; i + 3 < mp3.length; i++) {
    const b0 = mp3[i]
    const b1 = mp3[i + 1]
    const b3 = mp3[i + 3]
    if (b0 === 0xFF && b1 != null && (b1 & 0xE0) === 0xE0 && b3 != null)
      return (b3 >> 6) & 0x03
  }
  return -1
}

describe('encodeMp3', () => {
  // 2400 samples（mono 16-bit = 4800 bytes）的靜音、足夠產出 ≥1 個 frame
  const silence = Buffer.alloc(4800)

  it('產出非空 MP3、起始有 frame sync', () => {
    const mp3 = encodeMp3(silence, { sampleRate: 24000 })
    expect(mp3.length).toBeGreaterThan(0)
    expect(firstFrameChannelMode(mp3)).not.toBe(-1)
  })

  it('channels=2（預設）產 dual-mono stereo（非 mono 模式）', () => {
    const mp3 = encodeMp3(silence, { sampleRate: 24000 })
    expect(firstFrameChannelMode(mp3)).not.toBe(3) // 不是 mono
  })

  it('channels=1 產 mono 模式', () => {
    const mp3 = encodeMp3(silence, { sampleRate: 24000, channels: 1 })
    expect(firstFrameChannelMode(mp3)).toBe(3)
  })

  it('dEFAULT_MP3_BITRATE_KBPS 為 64', () => {
    expect(DEFAULT_MP3_BITRATE_KBPS).toBe(64)
  })
})
