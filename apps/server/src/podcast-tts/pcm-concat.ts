import { Buffer } from 'node:buffer'

export const DEFAULT_GAP_MS = 150

// 在 PCM 域串接各段 mono 16-bit PCM，段「之間」插入 gapMs 的 zero-fill 靜音
// （統一接縫、避免各段自帶首尾靜音造成不一致）。不在尾端補靜音。
export function concatPcmSegments(
  pcms: Buffer[],
  opts: { sampleRate: number, gapMs?: number },
): Buffer {
  const gapMs = opts.gapMs ?? DEFAULT_GAP_MS
  const gapBytes = Math.round((opts.sampleRate * gapMs) / 1000) * 2 // mono 16-bit = 2 bytes/sample
  const gap = Buffer.alloc(gapBytes)
  const parts: Buffer[] = []
  pcms.forEach((pcm, i) => {
    if (i > 0) {
      parts.push(gap)
    }
    parts.push(pcm)
  })
  return Buffer.concat(parts)
}
