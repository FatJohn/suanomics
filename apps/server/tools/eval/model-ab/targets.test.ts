import { describe, expect, it } from 'vitest'
import { VIEWPOINTS_DEBATE_CALLS_PER_RUN, VIEWPOINTS_DEBATE_PEAK } from '../../cli/lib/llm-run-estimates.js'
import { TARGETS } from './targets.js'

// eslint-disable-next-line test/prefer-lowercase-title -- TARGETS is the exported constant under test; lowercasing would misrepresent the symbol
describe('TARGETS 各 target 的 estimateCalls', () => {
  it('entity-summary：A × S × 3（每篇最壞情況 3 次重試）', () => {
    const t = TARGETS['entity-summary']
    expect(t?.estimateCalls({ armCount: 4, sampleCount: 9, dateCount: 0 })).toBe(4 * 9 * 3)
  })

  it('news-tagger：A × ceil(S/15)（拿掉 Math.ceil 會讓 S=37 這條紅：37/15=2.46→3，不取 ceil 會是 2）', () => {
    const t = TARGETS['news-tagger']
    expect(t?.estimateCalls({ armCount: 4, sampleCount: 37, dateCount: 0 })).toBe(4 * 3)
  })

  it('news-tagger：S 剛好整除時 ceil 不應多算一批', () => {
    const t = TARGETS['news-tagger']
    expect(t?.estimateCalls({ armCount: 2, sampleCount: 30, dateCount: 0 })).toBe(2 * 2)
  })

  it('viewpoints-debate：A × D × 3', () => {
    const t = TARGETS['viewpoints-debate']
    expect(t?.estimateCalls({ armCount: 4, sampleCount: 0, dateCount: 7 })).toBe(4 * 7 * VIEWPOINTS_DEBATE_CALLS_PER_RUN)
  })
})

// eslint-disable-next-line test/prefer-lowercase-title -- TARGETS is the exported constant under test; lowercasing would misrepresent the symbol
describe('TARGETS 各 target 的 estimatePeak', () => {
  it('entity-summary：等於呼叫端傳入的 --concurrency', () => {
    const t = TARGETS['entity-summary']
    expect(t?.estimatePeak({ armCount: 2, sampleCount: 9, dateCount: 0, concurrency: 4 })).toBe(4)
  })

  it('news-tagger：固定 1（batch 序列跑）', () => {
    const t = TARGETS['news-tagger']
    expect(t?.estimatePeak({ armCount: 2, sampleCount: 30, dateCount: 0, concurrency: 4 })).toBe(1)
  })

  it('viewpoints-debate：固定等於 VIEWPOINTS_DEBATE_PEAK（support/risk 平行）', () => {
    const t = TARGETS['viewpoints-debate']
    expect(t?.estimatePeak({ armCount: 2, sampleCount: 0, dateCount: 7, concurrency: 4 })).toBe(VIEWPOINTS_DEBATE_PEAK)
  })
})
