import type { Podcast } from '@suanomics/shared'
import { describe, expect, it } from 'vitest'
import { activeSegmentIndex, buildSegments, formatTime, nextRate, RATES, waveformBars, withEstimatedTimes } from './podcast-timeline.js'

const PODCAST = {
  briefDate: '2026-06-13',
  hook: { headline: 'h', body: 'AB' },
  acts: [
    { actTitle: '第一幕', storyline: 'rates', body: 'CCCC', citationUrls: ['u'], relatedNewsIds: ['1'] },
    { actTitle: '第二幕', storyline: 'ai-tech', body: 'DD', citationUrls: ['u'], relatedNewsIds: ['1'] },
  ],
  takeaway: { body: 'EE' },
  meta: { totalChars: 1800, persona: 'panpan', generatedAt: '2026-06-13T00:00:00.000Z' },
} as unknown as Podcast

describe('buildSegments', () => {
  it('shouldProduceHookActsTakeawayInOrder', () => {
    const segs = buildSegments(PODCAST)
    expect(segs.map(s => s.kind)).toEqual(['hook', 'act', 'act', 'takeaway'])
    expect(segs.map(s => s.label)).toEqual(['開場', '第一幕', '第二幕', '結語'])
    expect(segs[1]?.text).toBe('CCCC')
  })
})

describe('withEstimatedTimes', () => {
  it('shouldDistributeStartTimesByCumulativeChars', () => {
    const segs = withEstimatedTimes(buildSegments(PODCAST), 100)
    expect(segs.map(s => Math.round(s.startSec))).toEqual([0, 20, 60, 80])
  })
  it('shouldFallbackToZeroWhenDurationUnknown', () => {
    const segs = withEstimatedTimes(buildSegments(PODCAST), 0)
    expect(segs.every(s => s.startSec === 0)).toBe(true)
  })
})

describe('activeSegmentIndex', () => {
  it('shouldReturnLastSegmentWhoseStartIsReached', () => {
    const segs = withEstimatedTimes(buildSegments(PODCAST), 100)
    expect(activeSegmentIndex(segs, 0)).toBe(0)
    expect(activeSegmentIndex(segs, 25)).toBe(1)
    expect(activeSegmentIndex(segs, 999)).toBe(3)
  })
})

describe('formatTime', () => {
  it('shouldFormatMmSsAndGuardInvalid', () => {
    expect(formatTime(0)).toBe('0:00')
    expect(formatTime(178)).toBe('2:58')
    expect(formatTime(Number.NaN)).toBe('0:00')
    expect(formatTime(-5)).toBe('0:00')
  })
})

describe('nextRate', () => {
  it('shouldCycleThroughRates', () => {
    expect(RATES).toEqual([1, 1.25, 1.5, 2])
    expect(nextRate(1)).toBe(1.25)
    expect(nextRate(2)).toBe(1)
  })
})

describe('waveformBars', () => {
  it('shouldReturnDeterministicHeightsOfRequestedCount', () => {
    const a = waveformBars(56)
    const b = waveformBars(56)
    expect(a).toHaveLength(56)
    expect(a).toEqual(b)
    expect(a.every(h => h >= 4 && h <= 30)).toBe(true)
  })
})
