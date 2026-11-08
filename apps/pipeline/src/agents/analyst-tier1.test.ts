import { beforeEach, describe, expect, it, vi } from 'vitest'
import { callAnalystTier1 } from './analyst-tier1.js'
import * as wrapper from './llm-wrapper.js'
import { buildMarketCloseFraming } from './market-close-framing.js'

vi.mock('./llm-wrapper.js')

describe('callAnalystTier1 temporal label', () => {
  beforeEach(() => vi.resetAllMocks())
  it('主新聞前注入發布相對時間', async () => {
    vi.mocked(wrapper.callAgentLLM).mockResolvedValue({ primaryImpact: 'x', cascadeChains: [], reasoning: 'r' })
    await callAnalystTier1({
      newsTitle: '台股大跌',
      newsText: '台股今日重挫',
      newsId: 'n1',
      newsUrl: 'https://example.com/a',
      publishedAt: '2026-06-26T06:37:00Z',
      briefDate: '2026-06-27',
      decomposed: { primaryEntity: { name: 'x', kind: 'y' }, topicTags: [], cascadeHypotheses: [] },
      retrieved: [],
    })
    const uc = vi.mocked(wrapper.callAgentLLM).mock.calls[0]?.[0]?.userContent ?? ''
    expect(uc).toContain('發布時間: 昨日')
  })

  it('注入市場收盤時間框架 block', async () => {
    vi.mocked(wrapper.callAgentLLM).mockResolvedValue({ primaryImpact: 'x', cascadeChains: [], reasoning: 'r' })
    await callAnalystTier1({
      newsTitle: '台股大跌',
      newsText: '台股今日重挫',
      newsId: 'n1',
      newsUrl: 'https://example.com/a',
      publishedAt: '2026-06-26T06:37:00Z',
      briefDate: '2026-06-27',
      marketCloseFraming: buildMarketCloseFraming('2026-06-26', '2026-06-27'),
      decomposed: { primaryEntity: { name: 'x', kind: 'y' }, topicTags: [], cascadeHypotheses: [] },
      retrieved: [],
    })
    const uc = vi.mocked(wrapper.callAgentLLM).mock.calls[0]?.[0]?.userContent ?? ''
    expect(uc).toContain('市場收盤時間框架')
    expect(uc).toContain('台股（加權指數）最近收盤：昨日')
  })
})

// claims 整段掛在 ANALYST_CLAIMS_ENABLED 後面。
// 這組測試的核心不是「開了會怎樣」，而是**關了時餵給 LLM 的東西逐字沒變**——
// 部署啟用每日排程後，這裡的改動部署上去就會進報告。
describe('callAnalystTier1 claims', () => {
  const BASE = {
    newsTitle: '台股大跌',
    newsText: '台股重挫',
    newsId: 'n1',
    briefDate: '2026-08-05',
    decomposed: { primaryEntity: { name: 'x', kind: 'y' }, topicTags: [], cascadeHypotheses: [] },
    retrieved: [],
    citableSeries: [{ seriesId: 'us-sox', displayName: '費城半導體指數', asOf: '2026-08-04' }],
  }
  const LLM_OUT = {
    primaryImpact: 'x',
    cascadeChains: [],
    reasoning: 'r',
    claims: [{ kind: 'fact', claimType: 'named-number', claim: '費半收 11430.35 點', evidenceRefs: [{ kind: 'series', seriesId: 'us-sox', asOf: '2026-08-04' }] }],
  }

  beforeEach(() => {
    vi.resetAllMocks()
    delete process.env.ANALYST_CLAIMS_ENABLED
  })

  it('flag 關閉：prompt 不含可引用序列與 claim 契約、claims 為空', async () => {
    vi.mocked(wrapper.callAgentLLM).mockResolvedValue(LLM_OUT)
    const out = await callAnalystTier1(BASE)
    const call = vi.mocked(wrapper.callAgentLLM).mock.calls[0]?.[0]
    expect(call?.userContent ?? '').not.toContain('可引用序列')
    expect(call?.systemPrompt ?? '').not.toContain('EvidenceClaim')
    expect(JSON.stringify(call?.responseSchema ?? {})).not.toContain('claims')
    // 模型即使自己送了 claims 也不採用——關閉時本欄位不存在於契約中
    expect(out.claims).toEqual([])
  })

  it('flag 開啟：注入可引用序列與 claim 契約、claims 被正規化', async () => {
    process.env.ANALYST_CLAIMS_ENABLED = 'true'
    vi.mocked(wrapper.callAgentLLM).mockResolvedValue(LLM_OUT)
    const out = await callAnalystTier1(BASE)
    const call = vi.mocked(wrapper.callAgentLLM).mock.calls[0]?.[0]
    expect(call?.userContent ?? '').toContain('- seriesId: us-sox ｜ 費城半導體指數 ｜ asOf: 2026-08-04')
    expect(call?.systemPrompt ?? '').toContain('EvidenceClaim')
    expect(JSON.stringify(call?.responseSchema ?? {})).toContain('claims')
    expect(out.claims).toEqual([{
      id: 'c1',
      kind: 'fact',
      claimType: 'named-number',
      claim: '費半收 11430.35 點',
      evidenceRefs: [{ kind: 'series', seriesId: 'us-sox', asOf: '2026-08-04' }],
      asOf: '2026-08-04',
      checks: [],
    }])
  })

  it('flag 開啟但 citableSeries 為空：整段不出現（不留空標題）', async () => {
    process.env.ANALYST_CLAIMS_ENABLED = 'true'
    vi.mocked(wrapper.callAgentLLM).mockResolvedValue(LLM_OUT)
    await callAnalystTier1({ ...BASE, citableSeries: [] })
    expect(vi.mocked(wrapper.callAgentLLM).mock.calls[0]?.[0]?.userContent ?? '').not.toContain('可引用序列')
  })

  // 這次改動最重要的安全性質：claim 全壞不得帶走既有產出。
  it('claims 整段是垃圾時，其餘欄位完好、claims 降級成空陣列', async () => {
    process.env.ANALYST_CLAIMS_ENABLED = 'true'
    vi.mocked(wrapper.callAgentLLM).mockResolvedValue({
      primaryImpact: '主要衝擊',
      cascadeChains: [{ industry: '半導體', mechanism: 'm', affectedTickers: [], direction: 'negative', citations: [] }],
      reasoning: '推理',
      claims: 'not-an-array',
    })
    const out = await callAnalystTier1(BASE)
    expect(out.primaryImpact).toBe('主要衝擊')
    expect(out.cascadeChains).toHaveLength(1)
    expect(out.reasoning).toBe('推理')
    expect(out.claims).toEqual([])
  })
})
