import { beforeEach, describe, expect, it, vi } from 'vitest'
import { tagChainForceGroups } from './chain-grouper.js'
import * as wrapper from './llm-wrapper.js'

// Characterization test：在把 chain-grouper.ts 的 user content 字面值搬到
// prompts/chain-grouper.user-content.ts 之前，先把目前送給 LLM 的 user content 逐位元組釘住。
// `buildUserContent` 未 export，比照既有 chain-grouper.test.ts 的手法 mock callAgentLLM、
// 從呼叫參數取出 userContent 做 snapshot。覆蓋單一/多個力場名與單一/多個產業標籤。
vi.mock('./llm-wrapper.js')
vi.mock('../prompts/chain-grouper.prompt.js', () => ({
  CHAIN_GROUPER_SYSTEM_PROMPT: 'TEST_CHAIN_GROUPER_PROMPT',
}))

const llm = vi.mocked(wrapper.callAgentLLM)
function chain(industry: string) {
  return { industry, mechanism: 'm', affectedTickers: [], direction: 'positive' as const, citations: [] }
}
function firstUserContent(): string {
  return String(llm.mock.calls[0]?.[0]?.userContent ?? '')
}

describe('chain-grouper buildUserContent snapshot (characterization)', () => {
  beforeEach(() => {
    llm.mockReset()
  })

  it('captures multiple force names and multiple distinct industry labels', async () => {
    llm.mockResolvedValueOnce({ mapping: [] })
    await tagChainForceGroups({
      chains: [chain('半導體'), chain('銀行業'), chain('生技製藥CDMO')],
      forceNames: ['半導體與先進代工', '金融與證券業'],
    })
    expect(firstUserContent()).toMatchSnapshot()
  })

  it('captures a single force name and a single industry label', async () => {
    llm.mockResolvedValueOnce({ mapping: [] })
    await tagChainForceGroups({
      chains: [chain('半導體')],
      forceNames: ['半導體與先進代工'],
    })
    expect(firstUserContent()).toMatchSnapshot()
  })
})
