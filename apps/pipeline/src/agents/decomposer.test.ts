import { beforeEach, describe, expect, it, vi } from 'vitest'
import { callDecomposer } from './decomposer.js'
import * as wrapper from './llm-wrapper.js'

vi.mock('./llm-wrapper.js')
vi.mock('../prompts/decomposer.prompt.js', () => ({
  DECOMPOSER_SYSTEM_PROMPT: 'TEST_DECOMPOSER_PROMPT',
}))

describe('callDecomposer', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('should pass system prompt + news text to llm wrapper', async () => {
    vi.mocked(wrapper.callAgentLLM).mockResolvedValue({
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
    expect(wrapper.callAgentLLM).toHaveBeenCalledWith(expect.objectContaining({
      agentName: 'decomposer',
      systemPrompt: 'TEST_DECOMPOSER_PROMPT',
      userContent: expect.stringContaining('body'),
    }))
    expect(result.primaryEntity.name).toBe('TSMC')
  })

  it('should reject schema violation', async () => {
    vi.mocked(wrapper.callAgentLLM).mockResolvedValue({
      primaryEntity: { name: 'X' }, // missing kind
      topicTags: [],
      cascadeHypotheses: [],
    })
    await expect(callDecomposer({ newsTitle: 'T', newsText: 'b' })).rejects.toThrow()
  })

  it('should support 0 hypotheses', async () => {
    vi.mocked(wrapper.callAgentLLM).mockResolvedValue({
      primaryEntity: { name: 'X', kind: 'company' },
      topicTags: [],
      cascadeHypotheses: [],
    })
    const result = await callDecomposer({ newsTitle: 'T', newsText: 'b' })
    expect(result.cascadeHypotheses).toEqual([])
  })

  it('should pass newsId + onCallRecord through', async () => {
    vi.mocked(wrapper.callAgentLLM).mockResolvedValue({
      primaryEntity: { name: 'X', kind: 'company' },
      topicTags: [],
      cascadeHypotheses: [],
    })
    const onCallRecord = vi.fn()
    await callDecomposer({ newsTitle: 'T', newsText: 'b', newsId: 'news-1', onCallRecord })
    expect(wrapper.callAgentLLM).toHaveBeenCalledWith(expect.objectContaining({
      newsId: 'news-1',
      onCallRecord,
    }))
  })
})
