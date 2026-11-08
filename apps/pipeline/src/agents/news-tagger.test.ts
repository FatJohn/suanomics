import { afterEach, describe, expect, it, vi } from 'vitest'
import { callNewsTagger, normalizeTaggerResponse } from './news-tagger.js'

vi.mock('./llm-wrapper.js', () => ({ callAgentLLM: vi.fn() }))
const { callAgentLLM } = await import('./llm-wrapper.js')

afterEach(() => vi.clearAllMocks())

describe('normalizeTaggerResponse', () => {
  const inputIds = [1, 2, 3]
  it('keeps valid {id,tags} pairs in the input set, lowercased + trimmed + deduped', () => {
    const raw = { results: [{ id: 1, tags: ['Nvidia', ' nvidia ', 'Bond-Issuance'] }, { id: 2, tags: ['msci'] }] }
    expect(normalizeTaggerResponse(raw, inputIds)).toEqual([
      { id: 1, tags: ['nvidia', 'bond-issuance'] },
      { id: 2, tags: ['msci'] },
    ])
  })
  it('drops ids not in the input set', () => {
    const raw = { results: [{ id: 99, tags: ['x'] }] }
    expect(normalizeTaggerResponse(raw, inputIds)).toEqual([])
  })
  it('dedupes repeated ids (first wins)', () => {
    const raw = { results: [{ id: 1, tags: ['a'] }, { id: 1, tags: ['b'] }] }
    expect(normalizeTaggerResponse(raw, inputIds)).toEqual([{ id: 1, tags: ['a'] }])
  })
  it('skips items whose tags is not an array', () => {
    const raw = { results: [{ id: 1, tags: 'nope' }, { id: 2, tags: ['ok'] }] }
    expect(normalizeTaggerResponse(raw, inputIds)).toEqual([{ id: 2, tags: ['ok'] }])
  })
  it('caps tags at 6 and drops empty/non-string tags', () => {
    const raw = { results: [{ id: 1, tags: ['a', 'b', 'c', 'd', 'e', 'f', 'g', '', 3] }] }
    expect(normalizeTaggerResponse(raw, inputIds)).toEqual([{ id: 1, tags: ['a', 'b', 'c', 'd', 'e', 'f'] }])
  })
  it('returns [] for malformed input', () => {
    expect(normalizeTaggerResponse(null, inputIds)).toEqual([])
    expect(normalizeTaggerResponse({ results: 'x' }, inputIds)).toEqual([])
  })
  it('drops fractional / negative ids', () => {
    const raw = { results: [{ id: 1.5, tags: ['a'] }, { id: -1, tags: ['a'] }] }
    expect(normalizeTaggerResponse(raw, inputIds)).toEqual([])
  })
})

describe('callNewsTagger', () => {
  it('calls the news-tagger agent and normalizes the result', async () => {
    vi.mocked(callAgentLLM).mockResolvedValue({ results: [{ id: 10, tags: ['Nvidia', 'bond-issuance'] }] })
    const out = await callNewsTagger([{ id: 10, title: '輝達發債', excerpt: '200 億美元' }])
    expect(vi.mocked(callAgentLLM).mock.calls[0]?.[0]?.agentName).toBe('news-tagger')
    expect(vi.mocked(callAgentLLM).mock.calls[0]?.[0]?.userContent).toContain('[id=10] 輝達發債 — 200 億美元')
    expect(out).toEqual([{ id: 10, tags: ['nvidia', 'bond-issuance'] }])
  })
  it('returns [] for empty input without calling the LLM', async () => {
    const out = await callNewsTagger([])
    expect(out).toEqual([])
    expect(vi.mocked(callAgentLLM)).not.toHaveBeenCalled()
  })
})
