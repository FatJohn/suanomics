import type { EvidenceClaim, MarketBrief } from '@suanomics/shared'
import type { NewsItem } from './orchestrator.js'
import type { AnalystOutput } from './types.js'
import { describe, expect, it } from 'vitest'
import { formatUserContent } from './narrative-writer.js'

// Characterization test：釘住 callNarrativeWriter 組給模型的 user content 逐字內容，
// 在把字面值搬到 prompts/narrative-writer.user-content.ts 之前先凍結行為基線。
// 日期一律寫死、不用 new Date() / 亂數，確保 snapshot 可重現。

function claimOf(id: string, citationUrls: string[] = []): EvidenceClaim {
  return {
    id,
    kind: 'fact',
    claimType: 'named-number',
    claim: `claim ${id}`,
    evidenceRefs: citationUrls.map(url => ({ kind: 'citation' as const, url })),
    asOf: '2026-06-27',
    checks: [],
  }
}

const FULL_BRIEF: MarketBrief = {
  headline: '今日主要新聞標題',
  summary: '今日摘要內容、涵蓋科技與地緣政治兩條主線',
  relatedNews: [],
  affectedIndustries: [],
  relatedETFs: [],
  reasoningChain: ['r1', 'r2'],
  citations: [
    { url: 'https://example.com/c1', title: 'citation title one', quote: 'q' },
  ],
  disclaimer: '本分析僅供參考、非投資建議、實際投資請諮詢專業人士',
}

const FULL_NEWS: NewsItem[] = [
  { id: 'n1', title: '台積電法說會', url: 'https://example.com/n1', text: 'B'.repeat(600), publishedAt: '2026-06-27T04:00:00Z' },
  { id: 'n2', title: '短新聞標題', url: 'https://example.com/n2', text: '短內文', publishedAt: null },
]

const FULL_ANALYSTS: AnalystOutput[] = [
  {
    newsId: 'n1',
    primaryImpact: '半導體供應鏈受惠',
    reasoning: '訂單能見度延展、上游設備跟進擴產',
    cascadeChains: [
      { industry: '半導體', mechanism: 'M'.repeat(250), affectedTickers: ['2330', '2454'], direction: 'positive', citations: [], tier: 1 },
      { industry: '面板', mechanism: '短機制敘述', affectedTickers: ['2409'], direction: 'neutral', citations: [] },
    ],
    claims: [],
  },
  {
    newsId: 'n2',
    primaryImpact: '地緣政治風險升溫',
    reasoning: '中東緊張推升油價',
    cascadeChains: [],
    claims: [],
  },
  {
    newsId: 'n404',
    primaryImpact: '找不到對應新聞',
    reasoning: '測試 news lookup miss',
    cascadeChains: [],
    claims: [],
  },
  {
    // newsId 缺省 → 測試 `(none)` fallback
    primaryImpact: '沒有 newsId 的分析',
    reasoning: '測試 newsId undefined',
    cascadeChains: [],
    claims: [],
  },
]

const FULL_CITATIONS = [
  { url: 'https://example.com/c1', title: 'citation title one', quote: 'Q'.repeat(200) },
  { url: 'https://example.com/c2', title: 'citation title two', quote: 'short quote' },
]

describe('narrative-writer formatUserContent — characterization baseline', () => {
  it('renders the full template with every optional block, both branches of every conditional', () => {
    const out = formatUserContent(
      {
        brief: FULL_BRIEF,
        analystOutputs: FULL_ANALYSTS,
        news: FULL_NEWS,
        citations: FULL_CITATIONS,
        calendarBlock: '## 本週財經行事曆\n- 2026-06-30：FOMC 利率決策',
        storylineBlock: '## 追蹤中敘事線（今日有進展）\n- 範例線',
        officialBlock: '## 主管機關公告\n- 範例公告',
        mainThemes: ['主軸一：AI 算力需求', '主軸二：地緣政治風險'],
        dailyThesis: 'AI 算力需求正把市場關注從單一龍頭擴散到整條供應鏈',
        briefDate: '2026-06-27',
        marketCloseFraming: '## 市場收盤時間框架\n- 台股（加權指數）最近收盤：昨日',
        marketSnapshot: '## 今日市場數據\n- 加權指數：23,150 點（+0.8%）',
        claimLedger: [claimOf('c1', ['https://example.com/c1'])],
        weeklyRecapBlock: '## 本週敘事線回顧\n- 範例回顧',
      },
      true,
    )
    expect(out).toMatchSnapshot()
    expect(out).toContain('台積電法說會')
  })

  it('renders the minimal template: no optional blocks, no mainThemes fallback, withLedger=false', () => {
    const out = formatUserContent(
      {
        brief: {
          headline: 'h',
          summary: 's',
          relatedNews: [],
          affectedIndustries: [],
          relatedETFs: [],
          reasoningChain: ['r'],
          citations: [],
          disclaimer: '本分析僅供參考、非投資建議、實際投資請諮詢專業人士',
        },
        analystOutputs: [],
        news: [],
        citations: [],
        briefDate: '2026-01-05',
      },
      false,
    )
    expect(out).toMatchSnapshot()
    expect(out).toContain('（未提供）')
  })
})
