import { afterEach, describe, expect, it, vi } from 'vitest'
import { callNewsCategorizer, normalizeCategorizerResponse } from './news-categorizer.js'

vi.mock('./llm-wrapper.js', () => ({ callAgentLLM: vi.fn() }))
const { callAgentLLM } = await import('./llm-wrapper.js')

afterEach(() => vi.restoreAllMocks())

describe('normalizeCategorizerResponse', () => {
  const inputIds = [1, 2, 3]
  it('keeps valid {id,category} pairs that are in the input set', () => {
    const raw = { results: [{ id: 1, category: 'tech-semi' }, { id: 2, category: 'macro' }] }
    expect(normalizeCategorizerResponse(raw, inputIds)).toEqual([
      { id: 1, category: 'tech-semi' },
      { id: 2, category: 'macro' },
    ])
  })
  it('drops ids not in the input set and unknown categories', () => {
    const raw = { results: [{ id: 99, category: 'macro' }, { id: 3, category: 'garbage' }] }
    expect(normalizeCategorizerResponse(raw, inputIds)).toEqual([])
  })
  it('dedupes repeated ids (first wins)', () => {
    const raw = { results: [{ id: 1, category: 'macro' }, { id: 1, category: 'energy' }] }
    expect(normalizeCategorizerResponse(raw, inputIds)).toEqual([{ id: 1, category: 'macro' }])
  })
  it('returns [] for malformed input', () => {
    expect(normalizeCategorizerResponse(null, inputIds)).toEqual([])
    expect(normalizeCategorizerResponse({ results: 'x' }, inputIds)).toEqual([])
  })
  it('drops ids not in the input set (including fractional)', () => {
    const raw = { results: [{ id: 1.5, category: 'macro' }, { id: -1, category: 'macro' }] }
    expect(normalizeCategorizerResponse(raw, inputIds)).toEqual([])
  })
})

describe('callNewsCategorizer', () => {
  it('calls the news-categorizer agent and normalizes the result', async () => {
    vi.mocked(callAgentLLM).mockResolvedValue({ results: [{ id: 10, category: 'tech-semi' }] })
    const out = await callNewsCategorizer([{ id: 10, title: '台積電法說', excerpt: 'CoWoS 擴產' }])
    expect(vi.mocked(callAgentLLM).mock.calls[0]?.[0]?.agentName).toBe('news-categorizer')
    expect(vi.mocked(callAgentLLM).mock.calls[0]?.[0]?.userContent).toContain('[id=10] 台積電法說 — CoWoS 擴產')
    expect(out).toEqual([{ id: 10, category: 'tech-semi' }])
  })
})
