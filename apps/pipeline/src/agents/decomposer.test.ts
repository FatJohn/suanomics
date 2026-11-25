import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as wrapper from './call-agent.js'
import { callDecomposer } from './decomposer.js'

vi.mock('./call-agent.js')
vi.mock('../prompts/decomposer.prompt.js', () => ({
  DECOMPOSER_SYSTEM_PROMPT: 'TEST_DECOMPOSER_PROMPT',
}))

describe('callDecomposer', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('should pass system prompt + news text to llm wrapper', async () => {
    vi.mocked(wrapper.callAgent).mockResolvedValue({
      primaryEntity: { name: 'TSMC', kind: 'company' },
      topicTags: ['半導體'],
      cascadeHypotheses: [{
        industry: '散熱',
        mechanism: 'AI capex',
        retrieveQuery: { entities: ['TSMC'], topics: ['散熱'], days: 7 },
      }],
    })

    const result = await callDecomposer({
      newsTitle: 'T',
      newsText: 'body',
    })
    expect(wrapper.callAgent).toHaveBeenCalledWith('decomposer', {
      systemPrompt: 'TEST_DECOMPOSER_PROMPT',
      userContent: expect.stringContaining('body'),
    }, expect.anything(), {})
    expect(result.primaryEntity.name).toBe('TSMC')
  })

  it('should reject schema violation', async () => {
    vi.mocked(wrapper.callAgent).mockResolvedValue({
      primaryEntity: { name: 'X' }, // missing kind
      topicTags: [],
      cascadeHypotheses: [],
    })
    await expect(callDecomposer({ newsTitle: 'T', newsText: 'b' })).rejects.toThrow()
  })

  it('anthropic 不強制 maxItems：超過領域上限的陣列截斷，不整筆失敗', async () => {
    vi.mocked(wrapper.callAgent).mockResolvedValue({
      primaryEntity: { name: 'X', kind: 'company' },
      topicTags: ['a', 'b', 'c', 'd', 'e', 'f'],
      cascadeHypotheses: Array.from({ length: 7 }, (_, i) => ({ industry: `i${i}`, mechanism: 'm', retrieveQuery: {} })),
    })
    const result = await callDecomposer({ newsTitle: 'T', newsText: 'b' })
    expect(result.topicTags).toHaveLength(5)
    expect(result.cascadeHypotheses).toHaveLength(6)
  })

  it('should support 0 hypotheses', async () => {
    vi.mocked(wrapper.callAgent).mockResolvedValue({
      primaryEntity: { name: 'X', kind: 'company' },
      topicTags: [],
      cascadeHypotheses: [],
    })
    const result = await callDecomposer({ newsTitle: 'T', newsText: 'b' })
    expect(result.cascadeHypotheses).toEqual([])
  })

  it('should pass newsId + onCallRecord through', async () => {
    vi.mocked(wrapper.callAgent).mockResolvedValue({
      primaryEntity: { name: 'X', kind: 'company' },
      topicTags: [],
      cascadeHypotheses: [],
    })
    const onCallRecord = vi.fn()
    await callDecomposer({ newsTitle: 'T', newsText: 'b', newsId: 'news-1', onCallRecord })
    expect(wrapper.callAgent).toHaveBeenCalledWith('decomposer', expect.anything(), expect.anything(), {
      newsId: 'news-1',
      onCallRecord,
    })
  })
})
