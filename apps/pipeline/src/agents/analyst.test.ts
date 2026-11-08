import { beforeEach, describe, expect, it, vi } from 'vitest'
import { callAnalystTier1, callAnalystTier2 } from './analyst.js'
import * as wrapper from './llm-wrapper.js'

vi.mock('./llm-wrapper.js')
vi.mock('../prompts/analyst-tier1.prompt.js', () => ({
  ANALYST_TIER1_SYSTEM_PROMPT: 'TEST_ANALYST_PROMPT',
}))
vi.mock('../prompts/analyst-tier2.prompt.js', () => ({
  ANALYST_TIER2_SYSTEM_PROMPT: 'TEST_TIER2_PROMPT',
}))

describe('callAnalystTier1', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  const baseValid = {
    primaryImpact: 'x',
    cascadeChains: [{
      industry: 'i',
      mechanism: 'm',
      affectedTickers: ['NVDA'],
      direction: 'positive',
      citations: [{ url: 'https://known/1', title: 't', quote: 'q' }],
    }],
    reasoning: 'r',
  }

  it('should pass news + hypotheses + retrieved articles to LLM', async () => {
    vi.mocked(wrapper.callAgentLLM).mockResolvedValue(baseValid)
    await callAnalystTier1({
      newsTitle: 'T',
      newsText: 'body',
      decomposed: { primaryEntity: { name: 'X', kind: 'company' }, topicTags: [], cascadeHypotheses: [] },
      retrieved: [{ id: '1', url: 'https://known/1', title: 'r', contentSummary: 's', entities: [], topicTags: [], fetchedAt: '2026-04-25' }],
    })
    const args = vi.mocked(wrapper.callAgentLLM).mock.calls[0]?.[0]
    expect(args?.userContent).toContain('body')
    expect(args?.userContent).toContain('https://known/1')
  })

  it('should list the primary news url as a citable source even when retrieved is empty', async () => {
    vi.mocked(wrapper.callAgentLLM).mockResolvedValue(baseValid)
    await callAnalystTier1({
      newsTitle: 'T',
      newsText: 'body',
      newsUrl: 'https://src.example.com/primary-news',
      decomposed: { primaryEntity: { name: 'X', kind: 'company' }, topicTags: [], cascadeHypotheses: [] },
      retrieved: [],
    })
    const args = vi.mocked(wrapper.callAgentLLM).mock.calls[0]?.[0]
    expect(args?.userContent).toContain('https://src.example.com/primary-news')
  })

  it('should NOT strip a citation to the primary news url when retrieved is empty', async () => {
    vi.mocked(wrapper.callAgentLLM).mockResolvedValue({
      primaryImpact: 'x',
      cascadeChains: [{
        industry: 'i',
        mechanism: 'm',
        affectedTickers: [],
        direction: 'neutral',
        citations: [{ url: 'https://src.example.com/primary-news', title: 't', quote: 'q' }],
      }],
      reasoning: 'r',
    })
    const result = await callAnalystTier1({
      newsTitle: 'T',
      newsText: 'b',
      newsUrl: 'https://src.example.com/primary-news',
      decomposed: { primaryEntity: { name: 'X', kind: 'company' }, topicTags: [], cascadeHypotheses: [] },
      retrieved: [],
      maxFabricationRetries: 2,
    })
    expect(vi.mocked(wrapper.callAgentLLM)).toHaveBeenCalledTimes(1)
    expect(result.cascadeChains[0]?.citations[0]?.url).toBe('https://src.example.com/primary-news')
  })

  it('should retry when LLM cites URL not in retrieved set', async () => {
    vi.mocked(wrapper.callAgentLLM)
      .mockResolvedValueOnce({
        primaryImpact: 'x',
        cascadeChains: [{
          industry: 'i',
          mechanism: 'm',
          affectedTickers: [],
          direction: 'neutral',
          citations: [{ url: 'https://invented/666', title: 't', quote: 'q' }],
        }],
        reasoning: 'r',
      })
      .mockResolvedValueOnce(baseValid)

    const result = await callAnalystTier1({
      newsTitle: 'T',
      newsText: 'b',
      decomposed: { primaryEntity: { name: 'X', kind: 'company' }, topicTags: [], cascadeHypotheses: [] },
      retrieved: [{ id: '1', url: 'https://known/1', title: 'r', contentSummary: '', entities: [], topicTags: [], fetchedAt: '2026-04-25' }],
      maxFabricationRetries: 2,
    })
    expect(vi.mocked(wrapper.callAgentLLM)).toHaveBeenCalledTimes(2)
    expect(result.cascadeChains[0]?.citations[0]?.url).toBe('https://known/1')
  })

  it('should strip fabricated citations after max retries instead of throwing', async () => {
    vi.mocked(wrapper.callAgentLLM).mockResolvedValue({
      primaryImpact: 'x',
      cascadeChains: [{
        industry: 'i',
        mechanism: 'm',
        affectedTickers: [],
        direction: 'neutral',
        citations: [{ url: 'https://invented/666', title: 't', quote: 'q' }],
      }],
      reasoning: 'r',
    })
    const result = await callAnalystTier1({
      newsTitle: 'T',
      newsText: 'b',
      decomposed: { primaryEntity: { name: 'X', kind: 'company' }, topicTags: [], cascadeHypotheses: [] },
      retrieved: [{ id: '1', url: 'https://known/1', title: 'r', contentSummary: '', entities: [], topicTags: [], fetchedAt: '2026-04-25' }],
      maxFabricationRetries: 2,
    })
    // fabricated url stripped; citations should be empty (allowed url was never returned by LLM)
    expect(result.cascadeChains[0]?.citations).toHaveLength(0)
    // should have retried maxFabricationRetries times
    expect(vi.mocked(wrapper.callAgentLLM)).toHaveBeenCalledTimes(2)
  })

  it('should set fabricationStripped on the final LlmCallRecord when stripping', async () => {
    // wrapper 每次 invoke 時把 record forward 給呼叫方傳進來的 onCallRecord、
    // 模擬實際 production 的 callback chain
    // eslint-disable-next-line ts/no-explicit-any -- mock implementation, generic T type not inferrable at mock boundary
    vi.mocked(wrapper.callAgentLLM).mockImplementation(async (params: any) => {
      params.onCallRecord?.({
        agentName: 'analyst-tier1',
        tokensIn: 100,
        tokensOut: 50,
        costUsd: 0.001,
        latencyMs: 200,
        attempts: 1,
      })
      return {
        primaryImpact: 'x',
        cascadeChains: [{
          industry: 'i',
          mechanism: 'm',
          affectedTickers: [],
          direction: 'neutral',
          citations: [
            { url: 'https://invented/A', title: 't', quote: 'q' },
            { url: 'https://invented/B', title: 't', quote: 'q' },
          ],
        }],
        reasoning: 'r',
      }
    })

    // eslint-disable-next-line ts/no-explicit-any -- test record accumulator, typed at runtime
    const records: any[] = []
    await callAnalystTier1({
      newsTitle: 'T',
      newsText: 'b',
      decomposed: { primaryEntity: { name: 'X', kind: 'company' }, topicTags: [], cascadeHypotheses: [] },
      retrieved: [{ id: '1', url: 'https://known/1', title: 'r', contentSummary: '', entities: [], topicTags: [], fetchedAt: '2026-04-25' }],
      maxFabricationRetries: 2,
      onCallRecord: r => records.push(r),
    })

    expect(records).toHaveLength(2)
    // 前面 retry 不該帶 fabricationStripped marker（它是 final-strip 才設的旗標）
    expect(records[0]?.fabricationStripped).toBeUndefined()
    // 最後一次 retry 仍 fabricated → strip path、最後一筆 record 帶 count=2
    expect(records[1]?.fabricationStripped).toBe(2)
  })

  it('should not set fabricationStripped when LLM returns valid citations on first try', async () => {
    // eslint-disable-next-line ts/no-explicit-any -- mock implementation, generic T type not inferrable at mock boundary
    vi.mocked(wrapper.callAgentLLM).mockImplementation(async (params: any) => {
      params.onCallRecord?.({
        agentName: 'analyst-tier1',
        tokensIn: 100,
        tokensOut: 50,
        costUsd: 0.001,
        latencyMs: 200,
        attempts: 1,
      })
      return baseValid
    })

    // eslint-disable-next-line ts/no-explicit-any -- test record accumulator, typed at runtime
    const records: any[] = []
    await callAnalystTier1({
      newsTitle: 'T',
      newsText: 'b',
      decomposed: { primaryEntity: { name: 'X', kind: 'company' }, topicTags: [], cascadeHypotheses: [] },
      retrieved: [{ id: '1', url: 'https://known/1', title: 'r', contentSummary: '', entities: [], topicTags: [], fetchedAt: '2026-04-25' }],
      onCallRecord: r => records.push(r),
    })
    expect(records).toHaveLength(1)
    expect(records[0]?.fabricationStripped).toBeUndefined()
  })
})

describe('callAnalystTier1 market snapshot injection', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  const baseParams = {
    newsTitle: 'T',
    newsText: 'body',
    decomposed: { primaryEntity: { name: 'X', kind: 'company' }, topicTags: [], cascadeHypotheses: [] },
    retrieved: [],
  }

  it('analyst user content includes market snapshot with 主動解讀 directives', async () => {
    vi.mocked(wrapper.callAgentLLM).mockResolvedValue({ primaryImpact: 'p', cascadeChains: [], reasoning: 'r' })
    await callAnalystTier1({ ...baseParams, marketSnapshot: '## 今日市場數據\n- 加權指數：23,150 點' })
    const args = vi.mocked(wrapper.callAgentLLM).mock.calls[0]?.[0]
    expect(args?.userContent).toContain('## 今日市場數據')
    expect(args?.userContent).toContain('# 市場數據快照（主動解讀、不只當背景）')
    expect(args?.userContent).toContain('照抄快照提供的值')
    expect(args?.userContent).toContain('明確點出')
    expect(args?.userContent).not.toContain('僅供宏觀脈絡')
  })

  it('analyst user content omits market section when null', async () => {
    vi.mocked(wrapper.callAgentLLM).mockResolvedValue({ primaryImpact: 'p', cascadeChains: [], reasoning: 'r' })
    await callAnalystTier1({ ...baseParams, marketSnapshot: null })
    const args = vi.mocked(wrapper.callAgentLLM).mock.calls[0]?.[0]
    expect(args?.userContent).not.toContain('今日市場數據')
  })

  it('analyst user content omits market section when not provided', async () => {
    vi.mocked(wrapper.callAgentLLM).mockResolvedValue({ primaryImpact: 'p', cascadeChains: [], reasoning: 'r' })
    await callAnalystTier1(baseParams)
    const args = vi.mocked(wrapper.callAgentLLM).mock.calls[0]?.[0]
    expect(args?.userContent).not.toContain('今日市場數據')
  })
})

describe('analyst · quote truncation hotfix', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('should truncate cascadeChains[].citations[].quote when Gemini returns > 600 chars', async () => {
    const longQuote = 'A'.repeat(700)
    vi.mocked(wrapper.callAgentLLM).mockResolvedValue({
      primaryImpact: 'x',
      cascadeChains: [{
        industry: 'i',
        mechanism: 'm',
        affectedTickers: ['NVDA'],
        direction: 'positive',
        citations: [{ url: 'https://known/1', title: 't', quote: longQuote }],
      }],
      reasoning: 'r',
    })

    const result = await callAnalystTier1({
      newsTitle: 'T',
      newsText: 'b',
      decomposed: { primaryEntity: { name: 'X', kind: 'company' }, topicTags: [], cascadeHypotheses: [] },
      retrieved: [{ id: '1', url: 'https://known/1', title: 'r', contentSummary: '', entities: [], topicTags: [], fetchedAt: '2026-04-25' }],
    })

    const quote = result.cascadeChains[0]?.citations[0]?.quote
    expect(quote).toBeDefined()
    // eslint-disable-next-line ts/no-non-null-assertion -- toBeDefined() assertion above guarantees non-null
    expect(quote!.length).toBeLessThanOrEqual(600)
    // eslint-disable-next-line ts/no-non-null-assertion -- toBeDefined() assertion above guarantees non-null
    expect(quote!.endsWith('…')).toBe(true)
  })
})

describe('callAnalystTier2', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  const parentChain = {
    chainId: 't1-0',
    industry: '半導體封測',
    mechanism: 'AI capex 推 advanced packaging',
    nextTierEntities: ['愛德萬測試', '京瓷'],
  }

  it('returns tier 2 cascadeChains from Gemini output', async () => {
    vi.mocked(wrapper.callAgentLLM).mockResolvedValue({
      primaryImpact: 'tier 2 partner impact',
      cascadeChains: [{
        industry: '半導體測試設備',
        mechanism: '日月光 advanced packaging 訂單增 → 愛德萬測試 ATE 機台需求增',
        affectedTickers: ['6857.T'],
        direction: 'positive',
        citations: [{ url: 'https://known/x', title: 't', quote: 'q' }],
      }],
      reasoning: 'r',
    })
    const result = await callAnalystTier2({
      newsTitle: 'T',
      newsText: 'b',
      parentChain,
      retrieved: [{ id: '1', url: 'https://known/x', title: 'r', contentSummary: 's', entities: [], topicTags: [], fetchedAt: '2026-04-25' }],
    })
    expect(result.cascadeChains).toHaveLength(1)
    expect(result.cascadeChains[0]?.industry).toBe('半導體測試設備')
    expect(result.cascadeChains[0]?.affectedTickers).toContain('6857.T')
    // recursion bound：tier 2 chain 不應該有 nextTierEntities
    expect(result.cascadeChains[0]).not.toHaveProperty('nextTierEntities')
  })

  it('passes parent chain context into user content', async () => {
    vi.mocked(wrapper.callAgentLLM).mockResolvedValue({
      primaryImpact: 'p',
      cascadeChains: [],
      reasoning: 'r',
    })
    await callAnalystTier2({
      newsTitle: 'T',
      newsText: 'b',
      parentChain,
      retrieved: [],
    })
    const args = vi.mocked(wrapper.callAgentLLM).mock.calls[0]?.[0]
    expect(args?.userContent).toContain('半導體封測')
    expect(args?.userContent).toContain('AI capex 推 advanced packaging')
    expect(args?.userContent).toContain('愛德萬測試')
    expect(args?.agentName).toBe('analyst-tier2')
  })

  it('strips fabricated tier 2 citations after max retries', async () => {
    vi.mocked(wrapper.callAgentLLM).mockResolvedValue({
      primaryImpact: 'p',
      cascadeChains: [{
        industry: 'x',
        mechanism: 'm',
        affectedTickers: [],
        direction: 'neutral',
        citations: [{ url: 'https://invented/666', title: 't', quote: 'q' }],
      }],
      reasoning: 'r',
    })
    const result = await callAnalystTier2({
      newsTitle: 'T',
      newsText: 'b',
      parentChain,
      retrieved: [{ id: '1', url: 'https://known/1', title: 'r', contentSummary: '', entities: [], topicTags: [], fetchedAt: '2026-04-25' }],
      maxFabricationRetries: 2,
    })
    expect(result.cascadeChains[0]?.citations).toHaveLength(0)
    expect(vi.mocked(wrapper.callAgentLLM)).toHaveBeenCalledTimes(2)
  })

  // empty retrieved 時 prompt 指示 Gemini 留空、單次 call 完成
  it('returns empty cascadeChains and single call when retrieved is empty (Gemini honors instruction)', async () => {
    vi.mocked(wrapper.callAgentLLM).mockResolvedValue({
      primaryImpact: 'p',
      cascadeChains: [],
      reasoning: 'r',
    })
    const result = await callAnalystTier2({
      newsTitle: 'T',
      newsText: 'b',
      parentChain,
      retrieved: [],
    })
    expect(result.cascadeChains).toEqual([])
    expect(vi.mocked(wrapper.callAgentLLM)).toHaveBeenCalledTimes(1)
  })

  // edge case：retrieved 空但 Gemini 沒守紀律仍掰 url、allowedUrls 空集合 → 全 fabricated
  // → 應 retry maxRetries 次然後 strip 成空 citations
  it('loops to maxRetries and strips when retrieved is empty but Gemini fabricates URLs', async () => {
    vi.mocked(wrapper.callAgentLLM).mockResolvedValue({
      primaryImpact: 'p',
      cascadeChains: [{
        industry: 'x',
        mechanism: 'm',
        affectedTickers: [],
        direction: 'neutral',
        citations: [{ url: 'https://hallucinated/x', title: 't', quote: 'q' }],
      }],
      reasoning: 'r',
    })
    const result = await callAnalystTier2({
      newsTitle: 'T',
      newsText: 'b',
      parentChain,
      retrieved: [],
      maxFabricationRetries: 2,
    })
    expect(result.cascadeChains[0]?.citations).toEqual([])
    expect(vi.mocked(wrapper.callAgentLLM)).toHaveBeenCalledTimes(2)
  })
})

// NOTE: 這 describe 驗證 Zod parse path（AnalystOutputSchema.parse 保 nextTierEntities）。
// Gemini schema (RESPONSE_TIER1_GEMINI_SCHEMA) 本身的 shape 由 prod 路徑
// 驗、不在 unit test 範圍 — 因為 mock 攔截 callAgentLLM、
// Gemini structured-output 的 schema 永遠用不到。
describe('callAnalystTier1 nextTierEntities', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('preserves nextTierEntities when Gemini outputs them', async () => {
    // eslint-disable-next-line ts/no-explicit-any -- mock implementation, generic T type not inferrable at mock boundary
    vi.mocked(wrapper.callAgentLLM).mockImplementation(async (params: any) => {
      params.onCallRecord?.({
        agentName: 'analyst-tier1',
        tokensIn: 100,
        tokensOut: 50,
        costUsd: 0.001,
        latencyMs: 200,
        attempts: 1,
      })
      return {
        primaryImpact: 'p',
        cascadeChains: [{
          industry: '半導體封測',
          mechanism: 'm',
          affectedTickers: [],
          direction: 'positive',
          citations: [],
          nextTierEntities: ['愛德萬測試', '京瓷'],
        }],
        reasoning: 'r',
      }
    })
    const result = await callAnalystTier1({
      newsTitle: 't',
      newsText: 'x',
      decomposed: { primaryEntity: { name: 'X', kind: 'company' }, topicTags: [], cascadeHypotheses: [] },
      retrieved: [],
    })
    expect(result.cascadeChains[0]?.nextTierEntities).toEqual(['愛德萬測試', '京瓷'])
  })
})

describe('callAnalystTier2 market snapshot injection', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  const baseTier2Params = {
    newsTitle: 'T',
    newsText: 'body',
    parentChain: { chainId: 'c1', industry: 'i', mechanism: 'm', nextTierEntities: ['ASML'] },
    retrieved: [{ id: '1', url: 'https://example.com/a', title: 't', contentSummary: null, entities: [], topicTags: [], fetchedAt: '2026-06-13' }],
  }

  it('tier2 user content includes snapshot with 主動解讀 directives', async () => {
    vi.mocked(wrapper.callAgentLLM).mockResolvedValue({ primaryImpact: 'p', cascadeChains: [], reasoning: 'r' })
    await callAnalystTier2({ ...baseTier2Params, marketSnapshot: '## 今日市場數據\n- 加權指數：23,150 點' })
    const args = vi.mocked(wrapper.callAgentLLM).mock.calls[0]?.[0]
    expect(args?.userContent).toContain('# 市場數據快照（主動解讀、不只當背景）')
    expect(args?.userContent).toContain('檢查快照中是否有相關序列')
    expect(args?.userContent).toContain('無相關序列的主軸不要硬引用')
    expect(args?.userContent).toContain('## 今日市場數據')
  })

  it('tier2 user content omits snapshot section when absent', async () => {
    vi.mocked(wrapper.callAgentLLM).mockResolvedValue({ primaryImpact: 'p', cascadeChains: [], reasoning: 'r' })
    await callAnalystTier2(baseTier2Params)
    const args = vi.mocked(wrapper.callAgentLLM).mock.calls[0]?.[0]
    expect(args?.userContent).not.toContain('市場數據快照')
  })
})
