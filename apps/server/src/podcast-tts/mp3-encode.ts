import { Buffer } from 'node:buffer'
import { Mp3Encoder } from '@breezystack/lamejs'

export const DEFAULT_MP3_BITRATE_KBPS = 64

// 把 mono 16-bit LE PCM 編成 MP3。
// channels=2（預設）走 dual-mono stereo：
// 同一份 mono 樣本同時餵左右聲道（joint stereo 對「左右相同」近乎零成本壓縮）。
export function encodeMp3(
  pcm: Buffer,
  opts: { sampleRate: number, bitrateKbps?: number, channels?: number },
): Buffer {
  const channels = opts.channels ?? 2
  const bitrate = opts.bitrateKbps ?? DEFAULT_MP3_BITRATE_KBPS

  // 顯式 readInt16LE 複製、避開 Buffer pooling 的非對齊 byteOffset 問題
  const sampleCount = Math.floor(pcm.byteLength / 2)
  const samples = new Int16Array(sampleCount)
  for (let i = 0; i < sampleCount; i++) {
    samples[i] = pcm.readInt16LE(i * 2)
  }

  const encoder = new Mp3Encoder(channels, opts.sampleRate, bitrate)
  const blockSize = 1152 // MP3 frame 樣本數
  const parts: Buffer[] = []

  for (let i = 0; i < samples.length; i += blockSize) {
    const slice = samples.subarray(i, i + blockSize)
    // channels=2：把同一份 mono 樣本餵左右兩聲道（dual-mono stereo）
    const encoded = channels === 2
      ? encoder.encodeBuffer(slice, slice)
      : encoder.encodeBuffer(slice)
    if (encoded.length > 0)
      parts.push(Buffer.from(encoded.buffer, encoded.byteOffset, encoded.byteLength))
  }

  const tail = encoder.flush()
  if (tail.length > 0)
    parts.push(Buffer.from(tail.buffer, tail.byteOffset, tail.byteLength))

  return Buffer.concat(parts)
}
