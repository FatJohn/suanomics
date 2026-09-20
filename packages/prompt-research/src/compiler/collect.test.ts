import type { MergedDraft } from '../types.js'
import { describe, expect, it } from 'vitest'
import { collectFramesFromDraft } from './collect.js'

function draftWithFrames(): MergedDraft {
  return {
    generatedAt: '2026-06-12T00:00:00.000Z',
    sources: [],
    rawSourceRefs: [],
    frames: [
      {
        groupKey: 'liquidity-first',
        items: [
          {
            id: 'f1',
            sourceSlug: 'finance-live',
            frame: {
              id: 'f1',
              name: 'Frame 1：流動性優先',
              description: '先看流動性再看基本面',
              whenToApply: '央行政策轉向期',
              questions: ['M2 年增率趨勢？', '美債殖利率曲線形態？'],
            },
          },
        ],
      },
    ],
    vocabulary: [],
    redFlags: [],
  } as unknown as MergedDraft
}

describe('collectFramesFromDraft', () => {
  it('should return all frames from draft without any curation gate', () => {
    const out = collectFramesFromDraft(draftWithFrames())
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      id: 'f1',
      sourceSlug: 'finance-live',
      name: 'Frame 1：流動性優先',
      whenToApply: '央行政策轉向期',
    })
    expect(out[0]?.questions).toEqual(['M2 年增率趨勢？', '美債殖利率曲線形態？'])
  })

  it('should return empty array when draft has no frames', () => {
    const draft = { ...draftWithFrames(), frames: [] } as unknown as MergedDraft
    expect(collectFramesFromDraft(draft)).toEqual([])
  })
})
