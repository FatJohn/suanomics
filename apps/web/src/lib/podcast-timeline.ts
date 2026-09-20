import type { Podcast } from '@suanomics/shared'

export type SegmentKind = 'hook' | 'act' | 'takeaway'
export interface PodcastSegmentBase { kind: SegmentKind, label: string, text: string, chars: number }
export interface PodcastSegment extends PodcastSegmentBase { startSec: number }

export function buildSegments(podcast: Podcast): PodcastSegmentBase[] {
  const segs: PodcastSegmentBase[] = []
  segs.push({ kind: 'hook', label: '開場', text: podcast.hook.body, chars: podcast.hook.body.length })
  for (const act of podcast.acts)
    segs.push({ kind: 'act', label: act.actTitle, text: act.body, chars: act.body.length })
  segs.push({ kind: 'takeaway', label: '結語', text: podcast.takeaway.body, chars: podcast.takeaway.body.length })
  return segs
}

export function withEstimatedTimes(segments: PodcastSegmentBase[], durationSec: number): PodcastSegment[] {
  const total = segments.reduce((sum, s) => sum + s.chars, 0)
  if (total <= 0 || !Number.isFinite(durationSec) || durationSec <= 0)
    return segments.map(s => ({ ...s, startSec: 0 }))
  let acc = 0
  return segments.map((s) => {
    const startSec = (acc / total) * durationSec
    acc += s.chars
    return { ...s, startSec }
  })
}

export function activeSegmentIndex(segments: PodcastSegment[], currentSec: number): number {
  if (segments.length === 0)
    return -1
  let idx = 0
  segments.forEach((s, i) => {
    if (currentSec >= s.startSec)
      idx = i
  })
  return idx
}

export function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0)
    return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export const RATES = [1, 1.25, 1.5, 2] as const
export function nextRate(rate: number): number {
  const i = RATES.indexOf(rate as (typeof RATES)[number])
  return RATES[(i + 1) % RATES.length] ?? 1
}

export function waveformBars(count: number): number[] {
  const bars: number[] = []
  // 三個不同頻率正弦疊加 → 確定性偽波形（不用 Math.random、確保每次 render 一致）；高度範圍 [4, 30]px
  for (let i = 0; i < count; i++) {
    const v = Math.sin(i * 0.6) * 0.5 + Math.sin(i * 1.7 + 1) * 0.3 + Math.sin(i * 0.27) * 0.2
    bars.push(Math.round(4 + ((v + 1) / 2) * 26))
  }
  return bars
}
