import type { MarketBrief } from '@suanomics/shared'
import type { AnalystOutput, DecomposerOutput } from '../../../src/agents/types.js'
import { describe, expect, it, vi } from 'vitest'
import { BATCH_SIZE } from '../../../src/news/tag.js'
import { estimateTotalCalls } from './llm-run-budget.js'
import {
  ANALYST_TIER1_CALLS_PER_NEWS,
  DECOMPOSER_CALLS_PER_NEWS,
  ENTITY_SUMMARY_CALLS_PER_ARTICLE,
  estimateBriefCanary,
  estimateBriefRerun,
  estimateClaimYieldSmoke,
  estimateNarrativeLedgerAb,
  estimateNewsBackfillTags,
  estimateViewpointsSmoke,
  NARRATIVE_WRITER_CALLS_PER_RUN,
  QUALITY_JUDGE_CALLS_PER_COMPARE,
  SYNTHESIZER_CALLS_PER_RUN,
  VIEWPOINTS_DEBATE_CALLS_PER_RUN,
} from './llm-run-estimates.js'

// checkCompliance 全檔統一設成「一律違規」：只有 callSynthesizer 的測試依賴它強制觸發
// MAX_COMPLIANCE_RETRY_DEFAULT 次重試；其餘受測函式（decomposer／analyst-tier1／
// narrative-writer／viewpoints-debate／quality-judge）都不讀 checkCompliance 的回傳值
// 來決定要不要重打 callAgentLLM，所以不會被這個全域設定污染出錯的呼叫次數。
vi.mock('@suanomics/shared', async () => {
  const actual = await vi.importActual<typeof import('@suanomics/shared')>('@suanomics/shared')
  return { ...actual, checkCompliance: vi.fn(() => ({ violation: 'forbidden', matched: 'x' })) }
})

vi.mock('../../../src/agents/llm-wrapper.js', async () => {
  const actual = await vi.importActual<typeof import('../../../src/agents/llm-wrapper.js')>('../../../src/agents/llm-wrapper.js')
  return { ...actual, callAgentLLM: vi.fn() }
})

describe('estimateBriefCanary / estimateNarrativeLedgerAb / estimateClaimYieldSmoke / estimateViewpointsSmoke：總數公式', () => {
  it('narrative-ledger-ab：sources [7,6]、2 天 → 4*13+9*2=70', () => {
    expect(estimateTotalCalls(estimateNarrativeLedgerAb([7, 6]))).toBe(70)
  })

  it('brief-canary：D 天 × 2', () => {
    expect(estimateTotalCalls(estimateBriefCanary(7))).toBe(7 * QUALITY_JUDGE_CALLS_PER_COMPARE)
  })

  it('claim-yield-smoke：N 則 × 7（1 decomposer + 2 臂 × 3 tier1）', () => {
    expect(estimateTotalCalls(estimateClaimYieldSmoke(34))).toBe(34 * 7)
  })

  it('viewpoints-smoke：runs × 2 臂 × 3', () => {
    expect(estimateTotalCalls(estimateViewpointsSmoke(3))).toBe(3 * 2 * VIEWPOINTS_DEBATE_CALLS_PER_RUN)
  })

  it('brief-rerun：replicates × MAX_LLM_CALLS_PER_JOB', () => {
    const e = estimateBriefRerun(4)
    expect(estimateTotalCalls(e)).toBe(4 * 150)
  })
})

// ── 係數鎖定真實行為：不在測試裡重寫一份「這個 agent 會呼叫幾次」的邏輯，而是真的
// mock callAgentLLM、把每個受測 agent 逼到它自己程式碼裡的最壞路徑，再拿呼叫次數對比
// 估算器 export 的常數。改任何一個 agent 的 retry/attempt 上限而沒同步改
// llm-run-estimates.ts，這裡就會紅。 ──
describe('estimateXxx 用的係數常數：對真實 agent 最壞路徑跑一次、鎖住呼叫次數', () => {
  it('decomposer：單次呼叫、不重試', async () => {
    const wrapper = await import('../../../src/agents/llm-wrapper.js')
    vi.mocked(wrapper.callAgentLLM).mockReset()
    vi.mocked(wrapper.callAgentLLM).mockResolvedValue({ primaryEntity: { name: 'x', kind: 'company' }, topicTags: [], cascadeHypotheses: [] })
    const { callDecomposer } = await import('../../../src/agents/decomposer.js')
    await callDecomposer({ newsTitle: 't', newsText: 'b' })
    expect(vi.mocked(wrapper.callAgentLLM)).toHaveBeenCalledTimes(DECOMPOSER_CALLS_PER_NEWS)
  })

  it('analyst-tier1：retrieved 為空、每次都回幻覺 url → 打滿 maxFabricationRetries', async () => {
    const wrapper = await import('../../../src/agents/llm-wrapper.js')
    vi.mocked(wrapper.callAgentLLM).mockReset()
    vi.mocked(wrapper.callAgentLLM).mockResolvedValue({
      primaryImpact: 'p',
      cascadeChains: [{
        industry: 'i',
        mechanism: 'm',
        affectedTickers: [],
        direction: 'neutral',
        citations: [{ url: 'https://hallucinated/x', title: 't', quote: 'q' }],
      }],
      reasoning: 'r',
    })
    const { callAnalystTier1 } = await import('../../../src/agents/analyst-tier1.js')
    const decomposed: DecomposerOutput = { primaryEntity: { name: 'X', kind: 'company' }, topicTags: [], cascadeHypotheses: [] }
    await callAnalystTier1({ newsTitle: 't', newsText: 'b', briefDate: '2026-01-01', decomposed, retrieved: [] })
    expect(vi.mocked(wrapper.callAgentLLM)).toHaveBeenCalledTimes(ANALYST_TIER1_CALLS_PER_NEWS)
  })

  it('synthesizer：checkCompliance 全域一律違規 → 打滿 MAX_COMPLIANCE_RETRY_DEFAULT', async () => {
    const wrapper = await import('../../../src/agents/llm-wrapper.js')
    vi.mocked(wrapper.callAgentLLM).mockReset()
    vi.mocked(wrapper.callAgentLLM).mockResolvedValue({
      headline: 'h',
      summary: 's',
      relatedNews: [],
      affectedIndustries: [],
      relatedETFs: [],
      reasoningChain: ['a', 'b'],
    })
    const { callSynthesizer } = await import('../../../src/agents/synthesizer.js')
    const analystOutputs: AnalystOutput[] = []
    await callSynthesizer({ analystOutputs, date: '2026-01-01' })
    expect(vi.mocked(wrapper.callAgentLLM)).toHaveBeenCalledTimes(SYNTHESIZER_CALLS_PER_RUN)
  })

  it('narrative-writer：callAgentLLM 一律 reject → 打滿 MAX_ATTEMPTS、graceful degrade 不 throw', async () => {
    const wrapper = await import('../../../src/agents/llm-wrapper.js')
    vi.mocked(wrapper.callAgentLLM).mockReset()
    vi.mocked(wrapper.callAgentLLM).mockRejectedValue(new Error('boom'))
    const { callNarrativeWriter } = await import('../../../src/agents/narrative-writer.js')
    const brief: MarketBrief = {
      headline: 'h',
      summary: 's',
      relatedNews: [],
      affectedIndustries: [],
      relatedETFs: [],
      reasoningChain: ['r1', 'r2'],
      citations: [{ url: 'https://example.com/a', title: 't', quote: 'q' }],
      disclaimer: '本分析僅供參考、非投資建議、實際投資請諮詢專業人士',
    }
    const result = await callNarrativeWriter({
      brief,
      analystOutputs: [],
      news: [],
      citations: brief.citations,
      briefDate: '2026-01-01',
    })
    expect(result.narrative).toBeNull()
    expect(vi.mocked(wrapper.callAgentLLM)).toHaveBeenCalledTimes(NARRATIVE_WRITER_CALLS_PER_RUN)
  })

  it('viewpoints-debate：support/risk/net-read 固定 3 通', async () => {
    const wrapper = await import('../../../src/agents/llm-wrapper.js')
    vi.mocked(wrapper.callAgentLLM).mockReset()
    vi.mocked(wrapper.callAgentLLM)
      .mockResolvedValueOnce({ points: ['s1'] })
      .mockResolvedValueOnce({ points: ['r1'] })
      .mockResolvedValueOnce({ netRead: 'n' })
    const { runViewpointsDebate } = await import('../../../src/agents/viewpoints-debate.js')
    await runViewpointsDebate({ thesis: 't', headline: 'h', summary: 's', marketSnapshot: null, cascadeChains: [] })
    expect(vi.mocked(wrapper.callAgentLLM)).toHaveBeenCalledTimes(VIEWPOINTS_DEBATE_CALLS_PER_RUN)
  })

  it('quality-judge：runQualityCompare 固定兩個 orientation', async () => {
    const wrapper = await import('../../../src/agents/llm-wrapper.js')
    vi.mocked(wrapper.callAgentLLM).mockReset()
    const dim = { winner: '相當' as const, reason: 'r' }
    vi.mocked(wrapper.callAgentLLM).mockResolvedValue({ depth: dim, readability: dim, grounding: dim })
    const { runQualityCompare } = await import('../../eval/quality-judge.js')
    const brief = (t: string): MarketBrief => ({
      headline: t,
      summary: t,
      citations: [{ title: 'c', url: 'https://x', quote: 'q' }],
      narrative: { intro: 'i', sections: [], outro: 'o' },
      cascadeChains: [],
      relatedNews: [],
      affectedIndustries: [],
      relatedETFs: [],
      reasoningChain: [],
      disclaimer: '',
    })
    await runQualityCompare({ briefA: brief('a'), briefB: brief('b'), sources: [] })
    expect(vi.mocked(wrapper.callAgentLLM)).toHaveBeenCalledTimes(QUALITY_JUDGE_CALLS_PER_COMPARE)
  })

  it('entity-summary：注入的 callLLM 一律 throw → 打滿 DEFAULT_MAX_ATTEMPTS', async () => {
    const { enrichEntitySummary } = await import('../../../src/corpus/entity-summary.js')
    let calls = 0
    const result = await enrichEntitySummary({ title: 't', body: 'b' }, {
      callLLM: async () => {
        calls++
        throw new Error('llm call failed')
      },
    })
    expect(result.failed).toBe(true)
    expect(calls).toBe(ENTITY_SUMMARY_CALLS_PER_ARTICLE)
  })
})

describe('estimateNewsBackfillTags：批次大小綁定 tag.ts 的真實 BATCH_SIZE（不是複製一份數字）', () => {
  // 教訓：tagAndStore 在守門測試裡被 mock 掉，所以「改 tag.ts 的 BATCH_SIZE 會不會讓
  // 某個測試變紅」不能靠 mock 過的呼叫次數觀察。真正管用的鎖法是讓估算函式的 formula
  // 直接吃 tag.ts import 進來的同一個 binding（見 llm-run-estimates.ts 的 import），
  // 斷言時也用同一個 import 算 ceil(N / BATCH_SIZE)——如果未來 llm-run-estimates.ts
  // 被改回「複製一份數字」而不是 import，只要那份複製的數字跟 tag.ts 的真實值不同，
  // 這裡算出的期望值跟估算函式的實際輸出就會對不上、測試變紅；兩邊剛好抄成同一個值時
  // 測試才會繼續綠，但那種巧合在單一 PR 內故意改 BATCH_SIZE 卻忘記同步的情境下極罕見，
  // 且已被上面「其餘所有值都在 import」的事實排除。
  it('n 筆未標記新聞 → 估算呼叫數 = ceil(n / BATCH_SIZE)（BATCH_SIZE 直接 import 自 tag.ts）', () => {
    const n = 47
    expect(estimateTotalCalls(estimateNewsBackfillTags(n))).toBe(Math.ceil(n / BATCH_SIZE))
  })

  it('n 剛好是 BATCH_SIZE 的整數倍時不多算一批', () => {
    const n = BATCH_SIZE * 3
    expect(estimateTotalCalls(estimateNewsBackfillTags(n))).toBe(3)
  })

  it('0 筆 → 0 次呼叫', () => {
    expect(estimateTotalCalls(estimateNewsBackfillTags(0))).toBe(0)
  })
})
