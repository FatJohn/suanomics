import type { MarketBrief, Narrative, Podcast } from '@suanomics/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { callAgentLLM } from './llm-wrapper.js'
import { callPodcastWriter } from './podcast-writer.js'

// Characterization test：formatUserContent 在 podcast-writer.ts 內未 export，用既有測試
// 檔（podcast-writer.test.ts）同款手法 mock callAgentLLM、從呼叫參數取出 userContent 做
// snapshot。目的：在把字面值搬到 prompts/podcast-writer.user-content.ts 之前先凍結行為基線。

vi.mock('./llm-wrapper.js', async () => {
  const actual = await vi.importActual<typeof import('./llm-wrapper.js')>('./llm-wrapper.js')
  return { ...actual, callAgentLLM: vi.fn() }
})

const FULL_NARRATIVE: Narrative = {
  intro: '今日科技板塊呈現結構性分化、AI 算力需求拉動上游設備鏈。',
  sections: [
    { heading: 'AI 算力與半導體鏈', body: 'B'.repeat(300), relatedNewsIds: ['n1'], citationUrls: ['https://example.com/a'] },
  ],
  outro: '科技與地緣風險併行、配置上需平衡。',
}

const FULL_BRIEF: MarketBrief = {
  headline: '科技算力與地緣風險併行',
  summary: '今日摘要',
  relatedNews: [],
  affectedIndustries: [],
  relatedETFs: [],
  reasoningChain: ['r1', 'r2', 'r3'],
  citations: [
    { url: 'https://example.com/a', title: 'citation title one that is fairly long for clamp test purposes here yes indeed', quote: 'q' },
  ],
  disclaimer: '本分析僅供參考、非投資建議、實際投資請諮詢專業人士',
  narrative: FULL_NARRATIVE,
  newsTitlesById: { n1: 'news title one that is quite long so it may exceed the sixty character clamp boundary yes' },
  cascadeChains: [
    { industry: '半導體', mechanism: 'M'.repeat(250), affectedTickers: ['2330'], direction: 'positive', citations: [], tier: 1 },
    { industry: '面板', mechanism: '短機制', affectedTickers: ['2409'], direction: 'neutral', citations: [] },
  ],
}

const MINIMAL_BRIEF: MarketBrief = {
  headline: 'h',
  summary: 's',
  relatedNews: [],
  affectedIndustries: [],
  relatedETFs: [],
  reasoningChain: ['r'],
  citations: [],
  disclaimer: '本分析僅供參考、非投資建議、實際投資請諮詢專業人士',
}

function fakeValidPodcast(): Podcast {
  return {
    briefDate: '2026-04-30',
    hook: { headline: '今天聊一個你可能還沒注意到的訊號', body: '我胖胖、回來陪你聊本日財經。'.repeat(15) },
    acts: [
      { actTitle: 'act1', storyline: 'ai-tech', body: 'body1 '.repeat(60), citationUrls: ['https://example.com/a'], relatedNewsIds: ['n1'] },
      { actTitle: 'act2', storyline: 'geopolitics', body: 'body2 '.repeat(60), citationUrls: ['https://example.com/a'], relatedNewsIds: ['n1'] },
      { actTitle: 'act3', storyline: 'other', body: 'body3 '.repeat(60), citationUrls: ['https://example.com/a'], relatedNewsIds: ['n1'] },
    ],
    takeaway: { body: '想想看、如果這些訊號是真的、我們該怎麼配置？'.repeat(10) },
    meta: { totalChars: 2200, persona: 'panpan', generatedAt: '2026-04-30T01:00:00.000Z' },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('podcast-writer formatUserContent — characterization baseline', () => {
  it('renders the full template with every optional block, both branches of every conditional', async () => {
    vi.mocked(callAgentLLM).mockResolvedValueOnce(fakeValidPodcast() as unknown)
    await callPodcastWriter({
      briefDate: '2026-06-27',
      brief: FULL_BRIEF,
      calendarBlock: '## 本週財經行事曆\n- 2026-06-30：FOMC 利率決策',
      storylineBlock: '## 追蹤中敘事線（今日有進展）\n- 範例線',
      marketSnapshot: '## 今日市場數據\n- 加權指數：23,150 點（+0.8%）',
      marketCloseFraming: '## 市場收盤時間框架\n- 台股（加權指數）最近收盤：昨日',
    })
    const args = vi.mocked(callAgentLLM).mock.calls[0]?.[0]
    expect(args?.userContent).toMatchSnapshot()
    expect(args?.userContent).toContain('AI 算力與半導體鏈')
  })

  it('renders the minimal template: no narrative, no cascadeChains, no optional blocks', async () => {
    vi.mocked(callAgentLLM).mockResolvedValueOnce(fakeValidPodcast() as unknown)
    await callPodcastWriter({
      briefDate: '2026-01-05',
      brief: MINIMAL_BRIEF,
      calendarBlock: null,
      storylineBlock: null,
      marketSnapshot: null,
      marketCloseFraming: null,
    })
    const args = vi.mocked(callAgentLLM).mock.calls[0]?.[0]
    expect(args?.userContent).toMatchSnapshot()
    expect(args?.userContent).toContain('(narrative 為空、請從 brief 自行構建)')
    expect(args?.userContent).toContain('(無 cascade chains)')
  })
})
