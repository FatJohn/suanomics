import type { CallAnalystTier2Params } from './analyst-tier2.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { callAnalystTier2 } from './analyst-tier2.js'
import * as wrapper from './llm-wrapper.js'

vi.mock('./llm-wrapper.js')
// 系統 prompt 本體不在本切片範圍，替換成固定字串、讓 snapshot 只聚焦於本檔要搬的
// user content 模板（標題、指示句、feedback 訊息）。
vi.mock('../prompts/analyst-tier2.prompt.js', () => ({
  ANALYST_TIER2_SYSTEM_PROMPT: 'TEST_ANALYST_TIER2_SYSTEM_PROMPT',
}))

// `formatTier2UserContent` 未 export，只能透過 mock callAgentLLM、從呼叫參數取出
// userContent 做 snapshot（不為了測試改動 runner 的 export）。

const VALID_LLM_OUT = { primaryImpact: 'x', cascadeChains: [], reasoning: 'r' }

const FULL_PARAMS: CallAnalystTier2Params = {
  newsTitle: '半導體設備廠訂單回溫',
  newsText: '設備廠訂單自本季起明顯回溫、法人看好本波庫存回補。',
  newsId: 'n2',
  parentChain: {
    chainId: 't1-0',
    industry: '半導體',
    mechanism: '資本支出上調帶動設備採購',
    nextTierEntities: ['應用材料', '艾司摩爾'],
  },
  retrieved: [
    { id: '1', url: 'https://known.example.com/1', title: '設備訂單回溫報導', contentSummary: '訂單能見度拉長至下半年', entities: [], topicTags: [], fetchedAt: '2026-06-26' },
    { id: '2', url: 'https://known.example.com/2', title: '法人喊進設備股', contentSummary: null, entities: [], topicTags: [], fetchedAt: '2026-06-26' },
  ],
  marketSnapshot: '- 費城半導體指數：4,820 點（+0.8%）',
}

describe('analyst-tier2 user content snapshot', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('完整輸入', async () => {
    vi.mocked(wrapper.callAgentLLM).mockResolvedValue(VALID_LLM_OUT)
    await callAnalystTier2(FULL_PARAMS)
    const call = vi.mocked(wrapper.callAgentLLM).mock.calls[0]?.[0]
    expect(call?.userContent).toMatchSnapshot()
    expect(call?.systemPrompt).toMatchSnapshot()
  })

  it('retrieved 為空', async () => {
    vi.mocked(wrapper.callAgentLLM).mockResolvedValue(VALID_LLM_OUT)
    await callAnalystTier2({
      newsTitle: '半導體設備廠訂單回溫',
      newsText: '設備廠訂單自本季起明顯回溫、法人看好本波庫存回補。',
      parentChain: {
        chainId: 't1-0',
        industry: '半導體',
        mechanism: '資本支出上調帶動設備採購',
        nextTierEntities: ['應用材料'],
      },
      retrieved: [],
    })
    const call = vi.mocked(wrapper.callAgentLLM).mock.calls[0]?.[0]
    expect(call?.userContent).toMatchSnapshot()
  })

  it('無 marketSnapshot：不附加快照段落', async () => {
    vi.mocked(wrapper.callAgentLLM).mockResolvedValue(VALID_LLM_OUT)
    await callAnalystTier2({
      newsTitle: '半導體設備廠訂單回溫',
      newsText: '設備廠訂單自本季起明顯回溫、法人看好本波庫存回補。',
      parentChain: {
        chainId: 't1-0',
        industry: '半導體',
        mechanism: '資本支出上調帶動設備採購',
        nextTierEntities: ['應用材料', '艾司摩爾'],
      },
      retrieved: [
        { id: '1', url: 'https://known.example.com/1', title: '設備訂單回溫報導', contentSummary: '訂單能見度拉長至下半年', entities: [], topicTags: [], fetchedAt: '2026-06-26' },
      ],
    })
    const call = vi.mocked(wrapper.callAgentLLM).mock.calls[0]?.[0]
    expect(call?.userContent).toMatchSnapshot()
  })

  it('多個提名 partner 的 join 顯示', async () => {
    vi.mocked(wrapper.callAgentLLM).mockResolvedValue(VALID_LLM_OUT)
    await callAnalystTier2({
      newsTitle: '記憶體現貨價格走揚',
      newsText: 'DRAM 現貨價格連三週上漲。',
      parentChain: {
        chainId: 't1-1',
        industry: '記憶體',
        mechanism: 'AI 伺服器需求外溢',
        nextTierEntities: ['美光', '南亞科', 'SK 海力士'],
      },
      retrieved: [],
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
    await callAnalystTier2({
      newsTitle: '半導體設備廠訂單回溫',
      newsText: '設備廠訂單自本季起明顯回溫、法人看好本波庫存回補。',
      parentChain: {
        chainId: 't1-0',
        industry: '半導體',
        mechanism: '資本支出上調帶動設備採購',
        nextTierEntities: ['應用材料'],
      },
      retrieved: [
        { id: '1', url: 'https://known.example.com/1', title: 'r', contentSummary: null, entities: [], topicTags: [], fetchedAt: '2026-06-26' },
      ],
      maxFabricationRetries: 2,
    })
    expect(vi.mocked(wrapper.callAgentLLM)).toHaveBeenCalledTimes(2)
    const secondCall = vi.mocked(wrapper.callAgentLLM).mock.calls[1]?.[0]
    expect(secondCall?.userContent).toMatchSnapshot()
  })
})
