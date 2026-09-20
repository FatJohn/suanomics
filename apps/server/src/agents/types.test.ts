import { describe, expect, it } from 'vitest'
import {
  AnalystOutputSchema,
  CascadeChainSchema,
  CascadeHypothesisSchema,
  DecomposerOutputSchema,
} from './types.js'

describe('cascadeHypothesisSchema', () => {
  it('should accept valid hypothesis', () => {
    const ok = CascadeHypothesisSchema.safeParse({
      industry: '散熱供應鏈',
      mechanism: 'AI server CAPEX → 散熱模組需求',
      retrieveQuery: { entities: ['NVDA'], topics: ['AI 基礎建設'], days: 7 },
    })
    expect(ok.success).toBe(true)
  })

  it('should default days to 7', () => {
    const ok = CascadeHypothesisSchema.parse({
      industry: '散熱供應鏈',
      mechanism: 'AI server CAPEX → 散熱模組需求',
      retrieveQuery: {},
    })
    expect(ok.retrieveQuery.days).toBe(7)
  })
})

describe('decomposerOutputSchema', () => {
  it('should allow 0 hypotheses (普通新聞)', () => {
    const ok = DecomposerOutputSchema.safeParse({
      primaryEntity: { name: 'Foo', kind: 'company' },
      topicTags: [],
      cascadeHypotheses: [],
    })
    expect(ok.success).toBe(true)
  })

  it('should cap topicTags at 5', () => {
    const tooMany = DecomposerOutputSchema.safeParse({
      primaryEntity: { name: 'Foo', kind: 'company' },
      topicTags: ['1', '2', '3', '4', '5', '6'],
      cascadeHypotheses: [],
    })
    expect(tooMany.success).toBe(false)
  })

  it('should cap cascadeHypotheses at 6', () => {
    const seven = Array.from({ length: 7 }, (_, i) => ({
      industry: `i${i}`,
      mechanism: 'm',
      retrieveQuery: {},
    }))
    expect(DecomposerOutputSchema.safeParse({
      primaryEntity: { name: 'Foo', kind: 'company' },
      topicTags: [],
      cascadeHypotheses: seven,
    }).success).toBe(false)
  })
})

describe('analystOutputSchema', () => {
  it('should allow empty citations per chain (graceful degrade: strip fabricated)', () => {
    // Hot-fix: citations.min(0) — analyst strips fabricated urls rather than throw;
    // analyzer downstream injects synthetic placeholder to satisfy MarketBriefSchema.min(1).
    const noCit = AnalystOutputSchema.safeParse({
      primaryImpact: 'x',
      cascadeChains: [{
        industry: 'i',
        mechanism: 'm',
        affectedTickers: ['NVDA'],
        direction: 'positive',
        citations: [],
      }],
      reasoning: 'r',
    })
    expect(noCit.success).toBe(true)
  })

  it('should cap citations at 5', () => {
    const sixCit = AnalystOutputSchema.safeParse({
      primaryImpact: 'x',
      cascadeChains: [{
        industry: 'i',
        mechanism: 'm',
        affectedTickers: [],
        direction: 'neutral',
        citations: Array.from({ length: 6 }, (_, i) => ({
          url: `https://x/${i}`,
          title: 't',
          quote: 'q',
        })),
      }],
      reasoning: 'r',
    })
    expect(sixCit.success).toBe(false)
  })

  it('should restrict direction to sector-level enum', () => {
    const invalid = AnalystOutputSchema.safeParse({
      primaryImpact: 'x',
      cascadeChains: [{
        industry: 'i',
        mechanism: 'm',
        affectedTickers: [],
        direction: 'bullish', // not in enum
        citations: [{ url: 'http://x', title: 't', quote: 'q' }],
      }],
      reasoning: 'r',
    })
    expect(invalid.success).toBe(false)
  })

  it('should cap quote at 600 chars', () => {
    const longQuote = 'a'.repeat(601)
    const result = AnalystOutputSchema.safeParse({
      primaryImpact: 'x',
      cascadeChains: [{
        industry: 'i',
        mechanism: 'm',
        affectedTickers: [],
        direction: 'positive',
        citations: [{ url: 'http://x', title: 't', quote: longQuote }],
      }],
      reasoning: 'r',
    })
    expect(result.success).toBe(false)
  })

  it('should accept valid output with newsId', () => {
    const ok = AnalystOutputSchema.safeParse({
      newsId: 'news-123',
      primaryImpact: '台積電 Q1 financials 強勁、AI 訂單能見度延伸至 2026',
      cascadeChains: [{
        industry: '半導體封測',
        mechanism: '上游 wafer 出貨增加 → 下游封測需求',
        affectedTickers: ['ASE'],
        direction: 'positive',
        citations: [{
          url: 'https://example.com/news/1',
          title: '台積電財報',
          quote: 'EPS 12.5、毛利率 58%',
        }],
      }],
      reasoning: '需求延續性 + 庫存改善雙重驅動',
    })
    expect(ok.success).toBe(true)
  })
})

describe('cascadeChainSchema (tier metadata)', () => {
  const baseChain = {
    industry: '半導體封測',
    mechanism: 'AI 推 advanced packaging',
    affectedTickers: ['3711'],
    direction: 'positive' as const,
    citations: [],
  }

  it('accepts a legacy chain (no tier metadata)', () => {
    const ok = CascadeChainSchema.safeParse(baseChain)
    expect(ok.success).toBe(true)
  })

  it('accepts tier 1 chain with chainId + nextTierEntities', () => {
    const ok = CascadeChainSchema.safeParse({
      ...baseChain,
      chainId: 't1-0',
      tier: 1,
      nextTierEntities: ['愛德萬測試', '京瓷'],
    })
    expect(ok.success).toBe(true)
  })

  it('accepts tier 2 chain with parentChainId, no nextTierEntities', () => {
    const ok = CascadeChainSchema.safeParse({
      ...baseChain,
      chainId: 't2-0',
      tier: 2,
      parentChainId: 't1-0',
    })
    expect(ok.success).toBe(true)
  })

  it('rejects tier 1 chain WITH parentChainId', () => {
    const bad = CascadeChainSchema.safeParse({
      ...baseChain,
      chainId: 't1-0',
      tier: 1,
      parentChainId: 't1-99',
    })
    expect(bad.success).toBe(false)
  })

  it('rejects tier 2 chain WITHOUT parentChainId', () => {
    const bad = CascadeChainSchema.safeParse({
      ...baseChain,
      chainId: 't2-0',
      tier: 2,
    })
    expect(bad.success).toBe(false)
  })

  it('rejects tier 2 chain WITH nextTierEntities (recursion bound)', () => {
    const bad = CascadeChainSchema.safeParse({
      ...baseChain,
      chainId: 't2-0',
      tier: 2,
      parentChainId: 't1-0',
      nextTierEntities: ['x'],
    })
    expect(bad.success).toBe(false)
  })

  it('rejects malformed chainId', () => {
    const bad = CascadeChainSchema.safeParse({
      ...baseChain,
      chainId: 'invalid-id',
      tier: 1,
    })
    expect(bad.success).toBe(false)
  })

  it('rejects nextTierEntities longer than 5 regardless of tier', () => {
    const bad = CascadeChainSchema.safeParse({
      ...baseChain,
      nextTierEntities: ['a', 'b', 'c', 'd', 'e', 'f'],
    })
    expect(bad.success).toBe(false)
  })

  // forward-compat：schema 接受 tier 3、目前不產、未來可能用
  it('accepts tier 3 chain (forward-compat)', () => {
    const ok = CascadeChainSchema.safeParse({
      ...baseChain,
      chainId: 't3-0',
      tier: 3,
      parentChainId: 't2-0',
    })
    expect(ok.success).toBe(true)
  })

  // 故意 permissive：schema 不強制 tier 與 chainId 同時 stamp、orchestrator 自行確保
  // 兩者一起蓋（Option B）。本 test 把 permissiveness 變成 visible decision、
  // 避免未來改 schema 的人誤以為這是 oversight
  it('accepts tier without chainId (orchestrator co-stamps both, schema does not enforce)', () => {
    const ok = CascadeChainSchema.safeParse({
      ...baseChain,
      tier: 1,
      nextTierEntities: ['x'],
    })
    expect(ok.success).toBe(true)
  })
})
