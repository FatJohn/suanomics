import type { CascadeChain } from './types.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as analystMod from './analyst.js'
import * as retrieverMod from './retriever.js'
import { runTier2Fanout, stampTier1 } from './tier2-fanout.js'

vi.mock('./analyst.js')
vi.mock('./retriever.js')

describe('runTier2Fanout marketSnapshot pass-through', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('forwards marketSnapshot to callAnalystTier2', async () => {
    vi.mocked(retrieverMod.retrieveArticles).mockResolvedValue([
      { id: '1', url: 'https://example.com/a', title: 't', contentSummary: null, entities: [], topicTags: [], fetchedAt: '2026-06-13' },
    ])
    vi.mocked(analystMod.callAnalystTier2).mockResolvedValue({ primaryImpact: 'p', cascadeChains: [], reasoning: 'r' })
    const tier1: CascadeChain[] = stampTier1([{
      industry: 'i',
      mechanism: 'm',
      affectedTickers: [],
      direction: 'neutral',
      citations: [],
      nextTierEntities: ['ASML'],
    } as CascadeChain])
    await runTier2Fanout({
      news: { title: 'T', text: 'B' },
      tier1Chains: tier1,
      reportDate: '2026-06-12',
      aliases: { formToCanonical: new Map(), canonicalToAliases: new Map() },
      marketSnapshot: '## 今日市場數據',
      onCallRecord: () => {},
    })
    expect(vi.mocked(analystMod.callAnalystTier2).mock.calls[0]?.[0]?.marketSnapshot).toBe('## 今日市場數據')
    // ★ 二階檢索窗的上界也錨在報告日。釘的是**值**不只是「有傳」——
    //   改成 `taipeiDateOf(new Date())` 時這行要紅，補產舊報告才不會靜默用今天的窗。
    expect(vi.mocked(retrieverMod.retrieveArticles).mock.calls[0]?.[0]?.reportDate).toBe('2026-06-12')
  })
})
