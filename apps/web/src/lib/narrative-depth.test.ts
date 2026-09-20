import type { CascadeChain } from '@suanomics/shared'
import { describe, expect, it } from 'vitest'
import { chainsForSection, sectionDepthSummary, sectionForce } from './narrative-depth.js'

function chain(over: Partial<CascadeChain> & { urls?: string[] }): CascadeChain {
  const { urls = [], ...rest } = over
  return {
    industry: '半導體',
    mechanism: 'm',
    affectedTickers: [],
    direction: 'positive',
    citations: urls.map(url => ({ url, title: 't', quote: 'q' })),
    tier: 1,
    ...rest,
  } as CascadeChain
}

describe('chainsForSection', () => {
  const A = 'https://example.com/a'
  const B = 'https://example.com/b'
  const C = 'https://example.com/c'

  it('keeps chains that cite at least one of the section citation urls', () => {
    const chains = [chain({ industry: '甲', urls: [A] }), chain({ industry: '乙', urls: [C] })]
    expect(chainsForSection(chains, [A, B]).map(c => c.industry)).toEqual(['甲'])
  })
  it('drops tier ≥ 2 chains（展開層只放第一層、下層在完整連動區）', () => {
    const chains = [chain({ industry: '甲', urls: [A] }), chain({ industry: '乙', urls: [A], tier: 2, parentChainId: 't1-0' })]
    expect(chainsForSection(chains, [A]).map(c => c.industry)).toEqual(['甲'])
  })
  it('returns [] when the section shares no citation with any chain', () => {
    expect(chainsForSection([chain({ urls: [C] })], [A])).toEqual([])
  })
  it('returns [] for an empty chain list', () => {
    expect(chainsForSection([], [A])).toEqual([])
  })
  it('does not repeat a chain that cites two of the section urls', () => {
    expect(chainsForSection([chain({ urls: [A, B] })], [A, B])).toHaveLength(1)
  })
})

describe('sectionDepthSummary', () => {
  it('counts citations and links for the expand-layer label', () => {
    expect(sectionDepthSummary(4, 3)).toBe('展開這一節的 4 則引用與 3 條連動')
  })
  it('drops the link clause when a section has no linked chains', () => {
    expect(sectionDepthSummary(2, 0)).toBe('展開這一節的 2 則引用')
  })
  it('drops the citation clause when a section has no citations', () => {
    expect(sectionDepthSummary(0, 5)).toBe('展開這一節的 5 條連動')
  })
  it('returns null when there is nothing to expand（沒東西就不該出現這一條）', () => {
    expect(sectionDepthSummary(0, 0)).toBeNull()
  })
})

describe('sectionForce', () => {
  const A = 'https://example.com/a'
  it('reads 推升 when the linked chains lean positive', () => {
    const chains = [chain({ urls: [A], direction: 'positive' }), chain({ urls: [A], direction: 'positive' }), chain({ urls: [A], direction: 'negative' })]
    expect(sectionForce(chains)).toEqual({ kind: 'push', label: '推升' })
  })
  it('reads 壓抑 when the linked chains lean negative', () => {
    const chains = [chain({ urls: [A], direction: 'negative' }), chain({ urls: [A], direction: 'neutral' })]
    expect(sectionForce(chains)).toEqual({ kind: 'damp', label: '壓抑' })
  })
  it('returns null on a tie（分不出方向就不要硬標、那會逼讀者猜）', () => {
    expect(sectionForce([chain({ urls: [A], direction: 'positive' }), chain({ urls: [A], direction: 'negative' })])).toBeNull()
  })
  it('returns null when nothing is linked', () => {
    expect(sectionForce([])).toBeNull()
  })
  it('returns null when every linked chain is neutral', () => {
    expect(sectionForce([chain({ urls: [A], direction: 'neutral' })])).toBeNull()
  })
})
