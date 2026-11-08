import type { CallAnalystTier1Params } from './analyst-tier1.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { callAnalystTier1 } from './analyst-tier1.js'
import * as wrapper from './llm-wrapper.js'

vi.mock('./llm-wrapper.js')
// 系統 prompt 本體不在本切片範圍，替換成固定字串、讓 snapshot 只聚焦於本檔要搬的
// user content 模板（標題、指示句、feedback 訊息）。
vi.mock('../prompts/analyst-tier1.prompt.js', () => ({
  ANALYST_TIER1_SYSTEM_PROMPT: 'TEST_ANALYST_TIER1_SYSTEM_PROMPT',
}))

// `formatUserContent` 未 export，只能透過 mock callAgentLLM、從呼叫參數取出
// userContent／systemPrompt 做 snapshot（不為了測試改動 runner 的 export）。

const VALID_LLM_OUT = { primaryImpact: 'x', cascadeChains: [], reasoning: 'r' }

const FULL_PARAMS: CallAnalystTier1Params = {
  newsTitle: '台積電法說釋出樂觀展望',
  newsText: '台積電法說會上調全年資本支出、看好 AI 需求持續強勁。',
  newsId: 'n1',
  newsUrl: 'https://example.com/primary-news',
  publishedAt: '2026-06-26T06:37:00Z',
  briefDate: '2026-06-27',
  decomposed: {
    primaryEntity: { name: '台積電', kind: 'company' },
    topicTags: ['半導體', 'AI'],
    cascadeHypotheses: [
      { industry: '半導體設備', mechanism: '資本支出上調帶動設備採購', retrieveQuery: { days: 7 } },
      { industry: '記憶體', mechanism: 'AI 伺服器需求外溢', retrieveQuery: { days: 7 } },
    ],
  },
  retrieved: [
    { id: '1', url: 'https://known.example.com/1', title: '台積電法說重點整理', contentSummary: '上修資本支出至 400 億美元', entities: [], topicTags: [], fetchedAt: '2026-06-26' },
    { id: '2', url: 'https://known.example.com/2', title: '外資喊買半導體設備股', contentSummary: null, entities: [], topicTags: [], fetchedAt: '2026-06-26' },
  ],
  priorChains: Array.from({ length: 10 }, (_, i) => ({
    industry: `產業${i}`,
    mechanism: `機制描述${i}`,
    affectedTickers: [],
    direction: 'positive' as const,
    citations: [],
  })),
  marketSnapshot: '- 台股加權指數：22,345 點（+1.2%）\n- 美元兌台幣：31.5',
  marketCloseFraming: '# 市場收盤時間框架（描述行情漲跌/收盤的今日或昨日、以此為準）\n- 台股（加權指數）最近收盤：昨日（資料日 6/26）',
  citableSeries: [{ seriesId: 'us-sox', displayName: '費城半導體指數', asOf: '2026-06-26' }],
}

describe('analyst-tier1 user content snapshot', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    delete process.env.ANALYST_CLAIMS_ENABLED
  })

  it('完整輸入、claims 關閉', async () => {
    vi.mocked(wrapper.callAgentLLM).mockResolvedValue(VALID_LLM_OUT)
    await callAnalystTier1(FULL_PARAMS)
    const call = vi.mocked(wrapper.callAgentLLM).mock.calls[0]?.[0]
    expect(call?.userContent).toMatchSnapshot()
    expect(call?.systemPrompt).toMatchSnapshot()
  })

  it('完整輸入、claims 開啟（含可引用序列）', async () => {
    process.env.ANALYST_CLAIMS_ENABLED = 'true'
    vi.mocked(wrapper.callAgentLLM).mockResolvedValue(VALID_LLM_OUT)
    await callAnalystTier1(FULL_PARAMS)
    const call = vi.mocked(wrapper.callAgentLLM).mock.calls[0]?.[0]
    expect(call?.userContent).toMatchSnapshot()
    expect(call?.systemPrompt).toMatchSnapshot()
  })

  it('claims 開啟但 citableSeries 為空：不出現可引用序列段落', async () => {
    process.env.ANALYST_CLAIMS_ENABLED = 'true'
    vi.mocked(wrapper.callAgentLLM).mockResolvedValue(VALID_LLM_OUT)
    await callAnalystTier1({ ...FULL_PARAMS, citableSeries: [] })
    const call = vi.mocked(wrapper.callAgentLLM).mock.calls[0]?.[0]
    expect(call?.userContent).toMatchSnapshot()
  })

  it('最小輸入：無 newsUrl／publishedAt／priorChains／marketSnapshot／marketCloseFraming、retrieved 為空', async () => {
    vi.mocked(wrapper.callAgentLLM).mockResolvedValue(VALID_LLM_OUT)
    await callAnalystTier1({
      newsTitle: '台股大盤走勢',
      newsText: '台股今日開高走低。',
      briefDate: '2026-06-27',
      decomposed: { primaryEntity: { name: '台股', kind: 'index' }, topicTags: [], cascadeHypotheses: [] },
      retrieved: [],
    })
    const call = vi.mocked(wrapper.callAgentLLM).mock.calls[0]?.[0]
    expect(call?.userContent).toMatchSnapshot()
  })

  it('newsUrl 非 http：不列入可引用來源', async () => {
    vi.mocked(wrapper.callAgentLLM).mockResolvedValue(VALID_LLM_OUT)
    await callAnalystTier1({
      newsTitle: '台積電法說釋出樂觀展望',
      newsText: '台積電法說會上調全年資本支出、看好 AI 需求持續強勁。',
      newsUrl: 'not-a-url',
      briefDate: '2026-06-27',
      decomposed: { primaryEntity: { name: '台積電', kind: 'company' }, topicTags: [], cascadeHypotheses: [] },
      retrieved: [
        { id: '1', url: 'https://known.example.com/1', title: '台積電法說重點整理', contentSummary: '上修資本支出至 400 億美元', entities: [], topicTags: [], fetchedAt: '2026-06-26' },
      ],
    })
    const call = vi.mocked(wrapper.callAgentLLM).mock.calls[0]?.[0]
    expect(call?.userContent).toMatchSnapshot()
  })

  it('幻覺 citation 觸發重試：第二次呼叫的 userContent 含 feedback 區塊', async () => {
    vi.mocked(wrapper.callAgentLLM)
      .mockResolvedValueOnce({
        primaryImpact: 'x',
        cascadeChains: [{
          industry: '半導體',
          mechanism: 'm',
          affectedTickers: [],
          direction: 'neutral',
          citations: [{ url: 'https://invented.example.com/666', title: 't', quote: 'q' }],
        }],
        reasoning: 'r',
      })
      .mockResolvedValueOnce(VALID_LLM_OUT)
    await callAnalystTier1({
      newsTitle: '台股大盤走勢',
      newsText: '台股今日開高走低。',
      briefDate: '2026-06-27',
      decomposed: { primaryEntity: { name: '台股', kind: 'index' }, topicTags: [], cascadeHypotheses: [] },
      retrieved: [{ id: '1', url: 'https://known.example.com/1', title: 'r', contentSummary: null, entities: [], topicTags: [], fetchedAt: '2026-06-26' }],
      maxFabricationRetries: 2,
    })
    expect(vi.mocked(wrapper.callAgentLLM)).toHaveBeenCalledTimes(2)
    const secondCall = vi.mocked(wrapper.callAgentLLM).mock.calls[1]?.[0]
    expect(secondCall?.userContent).toMatchSnapshot()
  })
})
