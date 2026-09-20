import type { MarketBrief } from '@suanomics/shared'
import { describe, expect, it, vi } from 'vitest'
import { callAgentLLM } from '../../src/agents/llm-wrapper.js'
import { ContinuityCompareSchema, runContinuityCompare } from './continuity-judge.js'

vi.mock('../../src/agents/llm-wrapper.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/agents/llm-wrapper.js')>('../../src/agents/llm-wrapper.js')
  return { ...actual, callAgentLLM: vi.fn() }
})

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
    reasoningChain: ['a', 'b'],
    disclaimer: '本分析僅供參考、非投資建議、實際投資請諮詢專業人士',
  }
}

const DIM = { winner: '甲', reason: 'r' }
const VALID = { crossDay: DIM, thesisDelta: { winner: '乙', reason: 'r' }, resolvePayoff: { winner: '相當', reason: 'r' } }

describe('continuityCompareSchema', () => {
  it('接受合法三維度 winner+reason', () => {
    expect(ContinuityCompareSchema.parse(VALID)).toEqual(VALID)
  })
  it('winner 非 甲/乙/相當 → reject', () => {
    expect(ContinuityCompareSchema.safeParse({ ...VALID, crossDay: { winner: 'A', reason: 'r' } }).success).toBe(false)
  })
  it('缺維度 → reject', () => {
    expect(ContinuityCompareSchema.safeParse({ crossDay: DIM, thesisDelta: DIM }).success).toBe(false)
  })
})

describe('runContinuityCompare（雙 orientation 聚合）', () => {
  it('兩 orientation 都判 B 更連續 → crossDay 勝方 B（位置對調後仍 B）', async () => {
    // o1：A=甲、judge 說 crossDay 乙贏 → B；o2：B=甲、judge 說 crossDay 甲贏 → B
    vi.mocked(callAgentLLM)
      .mockResolvedValueOnce({ crossDay: { winner: '乙', reason: 'o1' }, thesisDelta: { winner: '相當', reason: '' }, resolvePayoff: { winner: '相當', reason: '' } })
      .mockResolvedValueOnce({ crossDay: { winner: '甲', reason: 'o2' }, thesisDelta: { winner: '相當', reason: '' }, resolvePayoff: { winner: '相當', reason: '' } })
    const r = await runContinuityCompare({ todayA: brief('A'), todayB: brief('B'), yesterday: brief('Y') })
    expect(r.crossDay.winner).toBe('B')
    expect(r.crossDay.reasons).toEqual(['o1', 'o2'])
  })
  it('兩 orientation 矛盾（都判「甲」）→ tie', async () => {
    vi.mocked(callAgentLLM)
      .mockResolvedValueOnce({ crossDay: { winner: '甲', reason: 'o1' }, thesisDelta: { winner: '相當', reason: '' }, resolvePayoff: { winner: '相當', reason: '' } })
      .mockResolvedValueOnce({ crossDay: { winner: '甲', reason: 'o2' }, thesisDelta: { winner: '相當', reason: '' }, resolvePayoff: { winner: '相當', reason: '' } })
    const r = await runContinuityCompare({ todayA: brief('A'), todayB: brief('B'), yesterday: brief('Y') })
    expect(r.crossDay.winner).toBe('tie')
  })
  it('三維各自獨立聚合（同一次：crossDay=A / thesisDelta=B / resolvePayoff=tie）', async () => {
    // o1：crossDay 甲(→A)、thesisDelta 乙(→B)、resolvePayoff 甲(→A)
    // o2：crossDay 乙(→A)、thesisDelta 甲(→B)、resolvePayoff 甲(→B)
    // 聚合：crossDay A,A→A；thesisDelta B,B→B；resolvePayoff A,B→tie
    vi.mocked(callAgentLLM)
      .mockResolvedValueOnce({ crossDay: { winner: '甲', reason: '' }, thesisDelta: { winner: '乙', reason: '' }, resolvePayoff: { winner: '甲', reason: '' } })
      .mockResolvedValueOnce({ crossDay: { winner: '乙', reason: '' }, thesisDelta: { winner: '甲', reason: '' }, resolvePayoff: { winner: '甲', reason: '' } })
    const r = await runContinuityCompare({ todayA: brief('A'), todayB: brief('B'), yesterday: brief('Y') })
    expect(r.crossDay.winner).toBe('A')
    expect(r.thesisDelta.winner).toBe('B')
    expect(r.resolvePayoff.winner).toBe('tie')
  })
})
