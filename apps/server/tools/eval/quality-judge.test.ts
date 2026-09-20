import type { MarketBrief } from '@suanomics/shared'
import { describe, expect, it, vi } from 'vitest'
import { callAgentLLM } from '../../src/agents/llm-wrapper.js'
import { QualityCompareSchema, runQualityCompare } from './quality-judge.js'

vi.mock('../../src/agents/llm-wrapper.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/agents/llm-wrapper.js')>('../../src/agents/llm-wrapper.js')
  return { ...actual, callAgentLLM: vi.fn() }
})

// 最小 MarketBrief fixture（只需要 quality-judge runner 消費的欄位）
function brief(t: string): MarketBrief {
  return {
    headline: t,
    summary: t,
    citations: [{ title: 'c', url: 'https://x', quote: 'q' }],
    narrative: { intro: 'i', sections: [], outro: 'o' },
    cascadeChains: [],
    relatedNews: [],
    affectedIndustries: [],
    relatedETFs: [],
    reasoningChain: [],
    disclaimer: '',
  }
}

const DIM = { winner: '甲', reason: 'r' }
const VALID = { depth: DIM, readability: { winner: '乙', reason: 'r' }, grounding: { winner: '相當', reason: 'r' } }

describe('qualityCompareSchema', () => {
  it('接受合法三維度 winner+reason', () => {
    expect(QualityCompareSchema.parse(VALID)).toEqual(VALID)
  })
  it('winner 非 甲/乙/相當 → reject', () => {
    expect(QualityCompareSchema.safeParse({ ...VALID, depth: { winner: 'A', reason: 'r' } }).success).toBe(false)
  })
  it('缺 reason → reject', () => {
    expect(QualityCompareSchema.safeParse({ ...VALID, depth: { winner: '甲' } }).success).toBe(false)
  })
})

describe('runQualityCompare', () => {
  it('兩 orientation 都判 A 更深 → depth 勝方 A（位置對調後仍 A）', async () => {
    // orientation 1：A=甲、judge 說 depth 甲贏 → A
    // orientation 2：B=甲（A=乙）、judge 說 depth 乙贏 → A
    vi.mocked(callAgentLLM)
      .mockResolvedValueOnce({ depth: { winner: '甲', reason: 'o1' }, readability: { winner: '相當', reason: '' }, grounding: { winner: '相當', reason: '' } })
      .mockResolvedValueOnce({ depth: { winner: '乙', reason: 'o2' }, readability: { winner: '相當', reason: '' }, grounding: { winner: '相當', reason: '' } })
    const r = await runQualityCompare({ briefA: brief('A'), briefB: brief('B'), sources: [] })
    expect(r.depth.winner).toBe('A')
    expect(r.depth.reasons).toEqual(['o1', 'o2'])
  })
  it('兩 orientation 矛盾（都判「甲」）→ tie', async () => {
    // 都說甲贏：o1 甲=A、o2 甲=B → A vs B → tie
    vi.mocked(callAgentLLM)
      .mockResolvedValueOnce({ depth: { winner: '甲', reason: 'o1' }, readability: { winner: '相當', reason: '' }, grounding: { winner: '相當', reason: '' } })
      .mockResolvedValueOnce({ depth: { winner: '甲', reason: 'o2' }, readability: { winner: '相當', reason: '' }, grounding: { winner: '相當', reason: '' } })
    const r = await runQualityCompare({ briefA: brief('A'), briefB: brief('B'), sources: [] })
    expect(r.depth.winner).toBe('tie')
  })
})
