import type { CascadeChain } from '@suanomics/shared'
import type { AnalystOutput } from '../agents/types.js'
import { describe, expect, it } from 'vitest'
import { assembleBriefCitations, assembleDailyBrief, filterCascadeCitations, isHttpUrl, resolveRelatedNews } from './assemble.js'

function analyst(chains: AnalystOutput['cascadeChains']): AnalystOutput {
  return { primaryImpact: 'x', cascadeChains: chains, reasoning: 'r' }
}
function chain(citations: { url: string, title: string, quote: string }[]) {
  return { industry: 'i', mechanism: 'm', affectedTickers: [], direction: 'neutral' as const, citations }
}

describe('isHttpUrl', () => {
  it('true for http(s)', () => {
    expect(isHttpUrl('https://news.cnyes.com/news/id/1')).toBe(true)
    expect(isHttpUrl('http://x.com')).toBe(true)
  })
  it('false for internal id / data: / garbage', () => {
    expect(isHttpUrl('news_us_iran_deal_nasdaq_surge')).toBe(false)
    expect(isHttpUrl('data:insufficient')).toBe(false)
    expect(isHttpUrl('')).toBe(false)
  })
})

describe('assembleBriefCitations', () => {
  it('keeps only http(s) urls, drops internal ids', () => {
    const out = assembleBriefCitations([analyst([chain([
      { url: 'https://a.com/1', title: 't1', quote: 'q1' },
      { url: 'news_internal_id', title: 't2', quote: 'q2' },
    ])])])
    expect(out.map(c => c.url)).toEqual(['https://a.com/1'])
  })

  it('dedups by url and orders by citation frequency desc', () => {
    const out = assembleBriefCitations([
      analyst([chain([{ url: 'https://low.com', title: 'l', quote: 'q' }])]),
      analyst([
        chain([{ url: 'https://high.com', title: 'h', quote: 'q' }]),
        chain([{ url: 'https://high.com', title: 'h', quote: 'q' }]),
      ]),
    ])
    expect(out.map(c => c.url)).toEqual(['https://high.com', 'https://low.com'])
  })

  it('caps at 20', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ url: `https://x.com/${i}`, title: 't', quote: 'q' }))
    const out = assembleBriefCitations([analyst([chain(many)])])
    expect(out.length).toBe(20)
  })

  it('falls back to data:insufficient sentinel when no http url', () => {
    const out = assembleBriefCitations([analyst([chain([{ url: 'internal_only', title: 't', quote: 'q' }])])])
    expect(out).toEqual([{ title: '資料不足', url: 'data:insufficient', quote: '此日無可佐證之外部來源連結' }])
  })

  it('fills empty title/quote so schema min(1) holds', () => {
    const out = assembleBriefCitations([analyst([chain([{ url: 'https://a.com', title: '', quote: '' }])])])
    expect(out[0]?.title.length).toBeGreaterThan(0)
    expect(out[0]?.quote.length).toBeGreaterThan(0)
  })
})

describe('resolveRelatedNews', () => {
  const byId = new Map([
    ['1', { title: '台積電擴廠', url: 'https://a.com/tsmc' }],
    ['2', { title: 'Fed 升息', url: 'https://a.com/fed' }],
  ])

  it('resolves newsId to real {title,url}, preserves relationType/reasoning', () => {
    const out = resolveRelatedNews(
      [{ newsId: '1', relationType: 'cause', reasoning: '起因' }],
      byId,
    )
    expect(out).toEqual([{ title: '台積電擴廠', url: 'https://a.com/tsmc', relationType: 'cause', reasoning: '起因' }])
  })

  it('drops refs whose newsId is not in the selected map', () => {
    const out = resolveRelatedNews(
      [{ newsId: '999', relationType: 'effect', reasoning: 'x' }],
      byId,
    )
    expect(out).toEqual([])
  })

  it('dedups repeated newsId', () => {
    const out = resolveRelatedNews(
      [{ newsId: '1', relationType: 'cause', reasoning: 'a' }, { newsId: '1', relationType: 'effect', reasoning: 'b' }],
      byId,
    )
    expect(out.length).toBe(1)
  })

  it('caps at 5', () => {
    const big = new Map(Array.from({ length: 8 }, (_, i) => [String(i), { title: `n${i}`, url: `https://a.com/${i}` }] as const))
    const refs = Array.from({ length: 8 }, (_, i) => ({ newsId: String(i), relationType: 'context' as const, reasoning: 'r' }))
    expect(resolveRelatedNews(refs, big).length).toBe(5)
  })
})

describe('filterCascadeCitations', () => {
  it('strips non-http citation urls from each chain', () => {
    const chains: CascadeChain[] = [{
      industry: 'i',
      mechanism: 'm',
      affectedTickers: [],
      direction: 'positive',
      citations: [
        { url: 'https://a.com/1', title: 't', quote: 'q' },
        { url: 'internal_id', title: 't', quote: 'q' },
      ],
    }]
    const out = filterCascadeCitations(chains)
    expect(out[0]?.citations.map(c => c.url)).toEqual(['https://a.com/1'])
  })
})

describe('assembleDailyBrief', () => {
  const synth = {
    headline: '今日總經',
    summary: '半導體與升息交織',
    relatedNews: [{ newsId: '1', relationType: 'cause' as const, reasoning: '起因' }],
    affectedIndustries: [],
    relatedETFs: [],
    reasoningChain: ['第一步', '第二步'],
  }
  const analystOutputs: AnalystOutput[] = [analyst([chain([{ url: 'https://a.com/1', title: 't', quote: 'q' }])])]
  const selectedNewsById = new Map([['1', { title: '台積電擴廠', url: 'https://a.com/tsmc' }]])

  it('produces a MarketBrief with real http citation urls', () => {
    const brief = assembleDailyBrief({ synth, analystOutputs, selectedNewsById, cascadeChains: [] })
    expect(brief.citations.every(c => c.url.startsWith('https://'))).toBe(true)
    expect(brief.citations[0]?.url).toBe('https://a.com/1')
  })

  it('resolves relatedNews to real url from selected news', () => {
    const brief = assembleDailyBrief({ synth, analystOutputs, selectedNewsById, cascadeChains: [] })
    expect(brief.relatedNews[0]).toMatchObject({ title: '台積電擴廠', url: 'https://a.com/tsmc', relationType: 'cause' })
  })

  it('forces the fixed disclaimer', () => {
    const brief = assembleDailyBrief({ synth, analystOutputs, selectedNewsById, cascadeChains: [] })
    expect(brief.disclaimer).toBe('本分析僅供參考、非投資建議、實際投資請諮詢專業人士')
  })

  it('passes MarketBriefSchema.parse (no throw)', () => {
    expect(() => assembleDailyBrief({ synth, analystOutputs, selectedNewsById, cascadeChains: [] })).not.toThrow()
  })

  it('persists a valid dailyThesis through the reader-facing safety gate', () => {
    const dailyThesis = '利率重新定價是今日跨市場波動的主要驅動因素'
    const brief = assembleDailyBrief({ synth, analystOutputs, selectedNewsById, cascadeChains: [], dailyThesis })
    expect(brief.dailyThesis).toBe(dailyThesis)
  })

  it('rewrites a forbidden phrase in dailyThesis before persisting it', () => {
    const brief = assembleDailyBrief({
      synth,
      analystOutputs,
      selectedNewsById,
      cascadeChains: [],
      dailyThesis: '市場看多氣氛帶動風險偏好延續',
    })
    expect(brief.dailyThesis).toBe('市場動能延續氣氛帶動風險偏好延續')
  })

  it('drops dailyThesis when compliance stripping leaves fewer than 10 chars', () => {
    const brief = assembleDailyBrief({
      synth,
      analystOutputs,
      selectedNewsById,
      cascadeChains: [],
      dailyThesis: '保證獲利保證獲利保證獲利',
    })
    expect(brief.dailyThesis).toBeUndefined()
  })

  it('clamps dailyThesis to the schema maximum', () => {
    const brief = assembleDailyBrief({
      synth,
      analystOutputs,
      selectedNewsById,
      cascadeChains: [],
      dailyThesis: '一'.repeat(151),
    })
    expect(brief.dailyThesis).toHaveLength(150)
  })

  it('strips non-http cascade citations through the gate', () => {
    const cascadeChains: CascadeChain[] = [{
      industry: 'i',
      mechanism: 'm',
      affectedTickers: [],
      direction: 'positive',
      citations: [
        { url: 'https://a.com/1', title: 't', quote: 'q' },
        { url: 'internal_id', title: 't', quote: 'q' },
      ],
    }]
    const brief = assembleDailyBrief({ synth, analystOutputs, selectedNewsById, cascadeChains })
    expect(brief.cascadeChains?.[0]?.citations.map(c => c.url)).toEqual(['https://a.com/1'])
  })
})
