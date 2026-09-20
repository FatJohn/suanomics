export interface SegmentTimecode {
  startMs: number
  durationMs: number
}

// 由各段 mono 16-bit PCM 的 byte 長度 + 段間 gap，累積出每段在合成音檔中的
// 起始時間與長度（ms）。與 concatPcmSegments 的 gap 規則一致（段間才加 gap）。
export function computeSegmentTimecodes(
  pcmByteLengths: number[],
  opts: { sampleRate: number, gapMs?: number },
): SegmentTimecode[] {
  const gapMs = opts.gapMs ?? 150
  const out: SegmentTimecode[] = []
  let cursor = 0
  pcmByteLengths.forEach((bytes, i) => {
    if (i > 0)
      cursor += gapMs
    const durationMs = Math.round((bytes / 2 / opts.sampleRate) * 1000)
    out.push({ startMs: cursor, durationMs })
    cursor += durationMs
  })
  return out
}
