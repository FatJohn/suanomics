import { checkCompliance } from '@suanomics/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as wrapper from './llm-wrapper.js'
import { callSynthesizer } from './synthesizer.js'

// Characterization test：在把 synthesizer.ts 的 user content 字面值搬到
// prompts/synthesizer.user-content.ts 之前，先把目前送給 LLM 的 user content 逐位元組釘住。
// `formatUserContent` 未 export，比照既有 synthesizer.test.ts 的手法 mock callAgentLLM、
// 從呼叫參數取出 userContent 做 snapshot。覆蓋：0 篇/多篇 analystOutputs、
// newsId 有無、cascadeChains 空/非空、tier/parentChainId/speculative 各自有無、
// marketCloseFraming 有無、marketSnapshot 有無、continuityHint 有無、
// compliance 違規重試時的 feedback 字面值。
vi.mock('./llm-wrapper.js')
vi.mock('../prompts/synthesizer.prompt.js', () => ({
  SYNTHESIZER_SYSTEM_PROMPT: 'TEST_SYN',
}))
vi.mock('@suanomics/shared', async () => {
  const actual = await vi.importActual<typeof import('@suanomics/shared')>('@suanomics/shared')
  return { ...actual, checkCompliance: vi.fn() }
})

const VALID_SYNTH = {
  headline: '產業連動觀察',
  summary: 'sector level analysis',
  relatedNews: [],
  affectedIndustries: [],
  relatedETFs: [],
  reasoningChain: ['第一步觀察', '第二步推論'],
}

function firstUserContent(): string {
  return String(vi.mocked(wrapper.callAgentLLM).mock.calls[0]?.[0]?.userContent ?? '')
}

describe('synthesizer formatUserContent snapshot (characterization)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(checkCompliance).mockReturnValue(null)
  })

  it('captures zero analystOutputs, no optional blocks', async () => {
    vi.mocked(wrapper.callAgentLLM).mockResolvedValue(VALID_SYNTH)
    await callSynthesizer({ analystOutputs: [], date: '2026-06-13' })
    expect(firstUserContent()).toMatchSnapshot()
  })

  it('captures multiple analystOutputs with newsId present/absent, empty cascadeChains', async () => {
    vi.mocked(wrapper.callAgentLLM).mockResolvedValue(VALID_SYNTH)
    await callSynthesizer({
      analystOutputs: [
        { newsId: 'n1', primaryImpact: '主衝擊一', cascadeChains: [], reasoning: '理由一' },
        { primaryImpact: '主衝擊二（無 newsId）', cascadeChains: [], reasoning: '理由二' },
      ],
      date: '2026-06-13',
    })
    expect(firstUserContent()).toMatchSnapshot()
  })

  it('captures cascadeChains with tier/parentChainId/speculative present and absent in the same output', async () => {
    vi.mocked(wrapper.callAgentLLM).mockResolvedValue(VALID_SYNTH)
    await callSynthesizer({
      analystOutputs: [{
        newsId: 'n1',
        primaryImpact: '主衝擊',
        cascadeChains: [
          {
            industry: '半導體',
            mechanism: '需求傳導',
            affectedTickers: ['2330'],
            direction: 'positive',
            citations: [{ url: 'https://example.com/a', title: 'A', quote: 'q1' }],
          },
          {
            industry: '封測',
            mechanism: '訂單轉移',
            affectedTickers: ['3711', '2317'],
            direction: 'neutral',
            citations: [],
            tier: 2,
            parentChainId: 't1-0',
            speculative: true,
          },
        ],
        reasoning: '綜合理由',
      }],
      date: '2026-06-13',
    })
    expect(firstUserContent()).toMatchSnapshot()
  })

  it('captures marketCloseFraming + marketSnapshot present together', async () => {
    vi.mocked(wrapper.callAgentLLM).mockResolvedValue(VALID_SYNTH)
    await callSynthesizer({
      analystOutputs: [],
      date: '2026-06-13',
      marketCloseFraming: '# 市場收盤時間框架\n台股收盤 13:30、美股收盤 05:00',
      marketSnapshot: '## 今日市場數據\n- 加權指數：23,150 點',
    })
    expect(firstUserContent()).toMatchSnapshot()
  })

  it('captures continuityHint present', async () => {
    vi.mocked(wrapper.callAgentLLM).mockResolvedValue(VALID_SYNTH)
    await callSynthesizer({
      analystOutputs: [],
      date: '2026-06-13',
      continuityHint: '延續主線「能源通膨」（已追蹤 3 天）：原油庫存意外增加',
    })
    expect(firstUserContent()).toMatchSnapshot()
  })

  it('captures compliance-violation retry feedback text appended to second call', async () => {
    vi.mocked(wrapper.callAgentLLM)
      .mockResolvedValueOnce({ ...VALID_SYNTH, summary: 'TSMC 加碼' })
      .mockResolvedValueOnce(VALID_SYNTH)
    vi.mocked(checkCompliance)
      .mockReturnValueOnce({ violation: 'ticker-direction', matched: 'TSMC 加碼' })
      .mockReturnValueOnce(null)
    await callSynthesizer({ analystOutputs: [], date: '2026-06-13' })
    const secondCall = String(vi.mocked(wrapper.callAgentLLM).mock.calls[1]?.[0]?.userContent ?? '')
    expect(secondCall).toMatchSnapshot()
  })
})
