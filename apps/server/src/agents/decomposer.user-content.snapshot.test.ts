import { beforeEach, describe, expect, it, vi } from 'vitest'
import { callDecomposer } from './decomposer.js'
import * as wrapper from './llm-wrapper.js'

// Characterization test：在把 decomposer.ts 的 user content 字面值搬到
// prompts/decomposer.user-content.ts 之前，先把目前送給 LLM 的 user content 逐位元組釘住。
// userContent 是單一組裝好的模板字串，比照既有 decomposer.test.ts 的手法 mock callAgentLLM、
// 從呼叫參數取出 userContent 做 snapshot。覆蓋一般標題/內文與含換行的長內文。
vi.mock('./llm-wrapper.js')
vi.mock('../prompts/decomposer.prompt.js', () => ({
  DECOMPOSER_SYSTEM_PROMPT: 'TEST_DECOMPOSER_PROMPT',
}))

const VALID_OUTPUT = {
  primaryEntity: { name: 'TSMC', kind: 'company' },
  topicTags: ['半導體'],
  cascadeHypotheses: [],
}

function firstUserContent(): string {
  return String(vi.mocked(wrapper.callAgentLLM).mock.calls[0]?.[0]?.userContent ?? '')
}

describe('decomposer userContent snapshot (characterization)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('captures normal title + single-line body', async () => {
    vi.mocked(wrapper.callAgentLLM).mockResolvedValue(VALID_OUTPUT)
    await callDecomposer({ newsTitle: '台積電法說會上修資本支出指引', newsText: '公司預期明年資本支出將顯著成長。' })
    expect(firstUserContent()).toMatchSnapshot()
  })

  it('captures multi-line body with embedded blank lines', async () => {
    vi.mocked(wrapper.callAgentLLM).mockResolvedValue(VALID_OUTPUT)
    await callDecomposer({
      newsTitle: '美國CPI數據優於預期',
      newsText: '第一段內容說明通膨降溫。\n\n第二段內容說明市場反應。\n第三行緊接著、不留空行。',
    })
    expect(firstUserContent()).toMatchSnapshot()
  })
})
