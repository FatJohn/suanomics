import type { EvidenceClaim } from '@suanomics/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as wrapper from './llm-wrapper.js'
import { runViewpointsDebate } from './viewpoints-debate.js'

// Characterization test：在把 viewpoints-debate.ts 三段 inline user content 模板搬到
// prompts/viewpoints-debate.user-content.ts 之前，先把目前送給 LLM 的三次呼叫 userContent
// 逐位元組釘住（support / risk / net-read，各自的模板都以 `${material}` 起頭）。
// 覆蓋：有/無 claimLedger、support/risk points 各為單點與多點（net-read 模板要把兩邊的
// points 都以 `- ` 條列接進去）。
vi.mock('./llm-wrapper.js')

const PARAMS = {
  thesis: '今日主線由 AI 算力與利率拉鋸主導',
  headline: 'AI 資本支出加速、利率預期分歧',
  summary: '半導體資本支出上修、市場對降息時點看法分歧',
  marketSnapshot: null,
  cascadeChains: [],
}

const llm = vi.mocked(wrapper.callAgentLLM)
function once(value: unknown) {
  llm.mockResolvedValueOnce(value as never)
}
function mockDebate(support: string[], risk: string[], netRead: string) {
  once({ points: support })
  once({ points: risk })
  once({ netRead })
}
function callUserContents(): [string, string, string] {
  return [
    String(llm.mock.calls[0]?.[0]?.userContent ?? ''),
    String(llm.mock.calls[1]?.[0]?.userContent ?? ''),
    String(llm.mock.calls[2]?.[0]?.userContent ?? ''),
  ]
}

describe('viewpoints-debate inline user content snapshot (characterization)', () => {
  beforeEach(() => vi.resetAllMocks())

  it('captures support/risk/net-read userContent with claimLedger and single point each', async () => {
    mockDebate(['支持論據一'], ['風險論據一'], 'a'.repeat(130))
    const claim: EvidenceClaim = {
      id: 'c18',
      kind: 'fact',
      claimType: 'named-number',
      claim: '2026年8月11日費城半導體指數收於12,098點。',
      evidenceRefs: [],
      asOf: '2026-08-11',
      checks: [],
    }
    await runViewpointsDebate({ ...PARAMS, claimLedger: [claim] })
    const [support, risk, netRead] = callUserContents()
    expect({ support, risk, netRead }).toMatchSnapshot()
  })

  it('captures support/risk/net-read userContent without claimLedger and multiple points each', async () => {
    mockDebate(['支持論據一', '支持論據二', '支持論據三'], ['風險論據一', '風險論據二'], 'b'.repeat(150))
    await runViewpointsDebate(PARAMS)
    const [support, risk, netRead] = callUserContents()
    expect({ support, risk, netRead }).toMatchSnapshot()
  })
})
