import type { EvidenceClaim, MarketBrief } from '@suanomics/shared'
import type { LlmCallRecord } from './llm-wrapper.js'
import type { NewsItem } from './orchestrator.js'
import type { AnalystOutput } from './types.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { NARRATIVE_WRITER_SYSTEM_PROMPT, NARRATIVE_WRITER_WEEKEND_SYSTEM_PROMPT } from '../prompts/narrative-writer.prompt.js'
import { callAgentLLM } from './llm-wrapper.js'
import { buildMarketCloseFraming } from './market-close-framing.js'
import { callNarrativeWriter } from './narrative-writer.js'

// 在 import 被測檔案之前 mock callAgentLLM、避免真打 Gemini
vi.mock('./llm-wrapper.js', async () => {
  const actual = await vi.importActual<typeof import('./llm-wrapper.js')>('./llm-wrapper.js')
  return {
    ...actual,
    callAgentLLM: vi.fn(),
  }
})

const FAKE_BRIEF: MarketBrief = {
  headline: 'h',
  summary: 's',
  relatedNews: [],
  affectedIndustries: [],
  relatedETFs: [],
  reasoningChain: ['r1', 'r2'],
  citations: [
    { url: 'https://example.com/a', title: 't', quote: 'q' },
    { url: 'https://example.com/b', title: 't', quote: 'q' },
  ],
  disclaimer: '本分析僅供參考、非投資建議、實際投資請諮詢專業人士',
}

const FAKE_ANALYSTS: AnalystOutput[] = [
  { newsId: 'n1', primaryImpact: 'pi', reasoning: 'r', cascadeChains: [] },
  { newsId: 'n2', primaryImpact: 'pi', reasoning: 'r', cascadeChains: [] },
]

const FAKE_NEWS: NewsItem[] = [
  { id: 'n1', title: 't1', url: 'https://example.com/n1', text: 'tx1', publishedAt: null },
  { id: 'n2', title: 't2', url: 'https://example.com/n2', text: 'tx2', publishedAt: null },
]

const VALID_NARRATIVE = {
  intro: 'a'.repeat(150),
  sections: [
    { heading: '主題一', body: 'a'.repeat(300), relatedNewsIds: ['n1'], citationUrls: ['https://example.com/a'] },
    { heading: '主題二', body: 'a'.repeat(300), relatedNewsIds: ['n2'], citationUrls: ['https://example.com/b'] },
  ],
  outro: 'a'.repeat(150),
}

beforeEach(() => {
  vi.mocked(callAgentLLM).mockReset()
})

describe('callNarrativeWriter', () => {
  it('returns parsed narrative on first attempt success', async () => {
    vi.mocked(callAgentLLM).mockResolvedValueOnce(VALID_NARRATIVE)
    const result = await callNarrativeWriter({
      brief: FAKE_BRIEF,
      analystOutputs: FAKE_ANALYSTS,
      news: FAKE_NEWS,
      citations: FAKE_BRIEF.citations,
      briefDate: '2026-06-27',
    })
    expect(result.narrative).toBeTruthy()
    expect(result.narrative?.sections).toHaveLength(2)
    expect(result.audit.failed).toBe(false)
    expect(callAgentLLM).toHaveBeenCalledTimes(1)
  })

  it('retries once on Zod parse fail and returns null on second fail', async () => {
    vi.mocked(callAgentLLM)
      .mockResolvedValueOnce({ ...VALID_NARRATIVE, intro: 'short' })
      .mockResolvedValueOnce({ ...VALID_NARRATIVE, intro: 'short' })
    const result = await callNarrativeWriter({
      brief: FAKE_BRIEF,
      analystOutputs: FAKE_ANALYSTS,
      news: FAKE_NEWS,
      citations: FAKE_BRIEF.citations,
      briefDate: '2026-06-27',
    })
    expect(result.narrative).toBeNull()
    expect(result.audit.failed).toBe(true)
    expect(result.audit.retryReason).toBe('zod-parse')
    expect(callAgentLLM).toHaveBeenCalledTimes(2)
  })

  it('retries once on Zod fail and succeeds on second attempt', async () => {
    vi.mocked(callAgentLLM)
      .mockResolvedValueOnce({ ...VALID_NARRATIVE, intro: 'short' })
      .mockResolvedValueOnce(VALID_NARRATIVE)
    const result = await callNarrativeWriter({
      brief: FAKE_BRIEF,
      analystOutputs: FAKE_ANALYSTS,
      news: FAKE_NEWS,
      citations: FAKE_BRIEF.citations,
      briefDate: '2026-06-27',
    })
    expect(result.narrative).toBeTruthy()
    expect(result.audit.failed).toBe(false)
    expect(callAgentLLM).toHaveBeenCalledTimes(2)
  })

  it('sanitizes forbidden phrases in narrative bodies (in-place, no retry)', async () => {
    const dirty = {
      ...VALID_NARRATIVE,
      sections: [
        // body 含 "看多" → 會被 NARRATIVE_REWRITE_MAP 改成 "動能延續"
        { heading: '主題一', body: `今日盤勢看多${'a'.repeat(290)}`, relatedNewsIds: ['n1'], citationUrls: ['https://example.com/a'] },
        { heading: '主題二', body: 'a'.repeat(300), relatedNewsIds: ['n2'], citationUrls: ['https://example.com/b'] },
      ],
    }
    vi.mocked(callAgentLLM).mockResolvedValueOnce(dirty)
    const result = await callNarrativeWriter({
      brief: FAKE_BRIEF,
      analystOutputs: FAKE_ANALYSTS,
      news: FAKE_NEWS,
      citations: FAKE_BRIEF.citations,
      briefDate: '2026-06-27',
    })
    expect(result.narrative).toBeTruthy()
    expect(result.narrative?.sections[0]?.body).not.toContain('看多')
    expect(result.narrative?.sections[0]?.body).toContain('動能延續')
    expect(result.audit.fabricationStripped).toBeGreaterThan(0)
    expect(callAgentLLM).toHaveBeenCalledTimes(1)
  })

  it('replaces unknown citation url with valid fallback (pre-clamp filter)', async () => {
    // preNormalizeNarrativeRaw 會 filter unknown URLs、空集 fallback 第一個 valid URL
    const badCitation = {
      ...VALID_NARRATIVE,
      sections: [
        { heading: '主題一', body: 'a'.repeat(300), relatedNewsIds: ['n1'], citationUrls: ['https://unknown.example.com/x'] },
        { heading: '主題二', body: 'a'.repeat(300), relatedNewsIds: ['n2'], citationUrls: ['https://example.com/b'] },
      ],
    }
    vi.mocked(callAgentLLM).mockResolvedValueOnce(badCitation)
    const result = await callNarrativeWriter({
      brief: FAKE_BRIEF,
      analystOutputs: FAKE_ANALYSTS,
      news: FAKE_NEWS,
      citations: FAKE_BRIEF.citations,
      briefDate: '2026-06-27',
    })
    expect(result.narrative).toBeTruthy()
    // section 0: unknown 被 filter 空、fallback 第一個 valid url (https://example.com/a)
    expect(result.narrative?.sections[0]?.citationUrls).toEqual(['https://example.com/a'])
    // section 1: 原 valid url 保留
    expect(result.narrative?.sections[1]?.citationUrls).toEqual(['https://example.com/b'])
    expect(result.audit.failed).toBe(false)
  })

  it('returns null on Gemini API error (after retry)', async () => {
    vi.mocked(callAgentLLM)
      .mockRejectedValueOnce(new Error('500 Internal Server Error'))
      .mockRejectedValueOnce(new Error('500 Internal Server Error'))
    const result = await callNarrativeWriter({
      brief: FAKE_BRIEF,
      analystOutputs: FAKE_ANALYSTS,
      news: FAKE_NEWS,
      citations: FAKE_BRIEF.citations,
      briefDate: '2026-06-27',
    })
    expect(result.narrative).toBeNull()
    expect(result.audit.failed).toBe(true)
    expect(result.audit.retryReason).toBe('gemini-api')
  })

  it('emits LlmCallRecord with narrativeFailed=true and retryReason on null result', async () => {
    const onCall = vi.fn()
    vi.mocked(callAgentLLM).mockRejectedValue(new Error('500'))
    const result = await callNarrativeWriter({
      brief: FAKE_BRIEF,
      analystOutputs: FAKE_ANALYSTS,
      news: FAKE_NEWS,
      citations: FAKE_BRIEF.citations,
      briefDate: '2026-06-27',
      onCallRecord: onCall,
    })
    expect(result.narrative).toBeNull()
    // 最後一筆 record 應該被 wrapper 標記 narrativeFailed
    const lastCall = onCall.mock.calls.at(-1)?.[0] as LlmCallRecord | undefined
    expect(lastCall?.narrativeFailed).toBe(true)
    expect(lastCall?.narrativeRetryReason).toBe('gemini-api')
  })

  it('drops hallucinated relatedNewsIds not in input news (preNormalize)', async () => {
    const withBadRel = {
      ...VALID_NARRATIVE,
      sections: [
        { heading: '主題一', body: 'a'.repeat(300), relatedNewsIds: ['n1', 'n-hallucinated'], citationUrls: ['https://example.com/a'] },
        { heading: '主題二', body: 'a'.repeat(300), relatedNewsIds: ['n2'], citationUrls: ['https://example.com/b'] },
      ],
    }
    vi.mocked(callAgentLLM).mockResolvedValueOnce(withBadRel)
    const result = await callNarrativeWriter({ brief: FAKE_BRIEF, analystOutputs: FAKE_ANALYSTS, news: FAKE_NEWS, citations: FAKE_BRIEF.citations, briefDate: '2026-06-27' })
    expect(result.narrative?.sections[0]?.relatedNewsIds).toEqual(['n1']) // n-hallucinated 不在 FAKE_NEWS、被 drop
  })

  it('clamps overlong heading to <= 40 (preNormalize)', async () => {
    const longHeading = {
      ...VALID_NARRATIVE,
      sections: [
        { heading: '標'.repeat(60), body: 'a'.repeat(300), relatedNewsIds: ['n1'], citationUrls: ['https://example.com/a'] },
        { heading: '主題二', body: 'a'.repeat(300), relatedNewsIds: ['n2'], citationUrls: ['https://example.com/b'] },
      ],
    }
    vi.mocked(callAgentLLM).mockResolvedValueOnce(longHeading)
    const result = await callNarrativeWriter({ brief: FAKE_BRIEF, analystOutputs: FAKE_ANALYSTS, news: FAKE_NEWS, citations: FAKE_BRIEF.citations, briefDate: '2026-06-27' })
    expect((result.narrative?.sections[0]?.heading.length ?? 0)).toBeLessThanOrEqual(40)
  })

  it('truncates overlong body at sentence boundary without 「…」', async () => {
    const longBody = '這是一段完整的論述句子。'.repeat(80) // 960 字、每句以。結尾
    vi.mocked(callAgentLLM).mockResolvedValueOnce({
      ...VALID_NARRATIVE,
      sections: [
        { heading: '主題一', body: longBody, relatedNewsIds: ['n1'], citationUrls: ['https://example.com/a'] },
      ],
    })
    const result = await callNarrativeWriter({
      brief: FAKE_BRIEF,
      analystOutputs: FAKE_ANALYSTS,
      news: FAKE_NEWS,
      citations: FAKE_BRIEF.citations,
      briefDate: '2026-06-27',
    })
    const body = result.narrative?.sections[0]?.body ?? ''
    expect(body.length).toBeLessThanOrEqual(800)
    expect(body.endsWith('。')).toBe(true)
    expect(body).not.toContain('…')
  })

  it('truncates overlong intro at sentence boundary without 「…」', async () => {
    const longIntro = '今日市場主線清楚。'.repeat(40) // 360 字 > 320
    vi.mocked(callAgentLLM).mockResolvedValueOnce({ ...VALID_NARRATIVE, intro: longIntro })
    const result = await callNarrativeWriter({
      brief: FAKE_BRIEF,
      analystOutputs: FAKE_ANALYSTS,
      news: FAKE_NEWS,
      citations: FAKE_BRIEF.citations,
      briefDate: '2026-06-27',
    })
    const intro = result.narrative?.intro ?? ''
    expect(intro.length).toBeLessThanOrEqual(320)
    expect(intro.endsWith('。')).toBe(true)
    expect(intro).not.toContain('…')
  })
})

describe('callNarrativeWriter compliance gate', () => {
  // 一定會漲 = FORBIDDEN、不在 rewrite map；outro 需 >=120 chars 才能通過 Zod、確保 gate 是觸發點
  const FORBIDDEN_OUTRO = `一定會漲${'a'.repeat(120)}`
  it('degrades to null when narrative still violates compliance after retries', async () => {
    const bad = { ...VALID_NARRATIVE, outro: FORBIDDEN_OUTRO }
    vi.mocked(callAgentLLM).mockResolvedValueOnce(bad).mockResolvedValueOnce(bad)
    const r = await callNarrativeWriter({
      brief: FAKE_BRIEF,
      analystOutputs: FAKE_ANALYSTS,
      news: FAKE_NEWS,
      citations: FAKE_BRIEF.citations,
      briefDate: '2026-06-27',
    })
    expect(r.narrative).toBeNull()
    expect(callAgentLLM).toHaveBeenCalledTimes(2)
  })
  it('recovers when retry returns compliant narrative', async () => {
    const bad = { ...VALID_NARRATIVE, outro: FORBIDDEN_OUTRO }
    vi.mocked(callAgentLLM).mockResolvedValueOnce(bad).mockResolvedValueOnce(VALID_NARRATIVE)
    const r = await callNarrativeWriter({
      brief: FAKE_BRIEF,
      analystOutputs: FAKE_ANALYSTS,
      news: FAKE_NEWS,
      citations: FAKE_BRIEF.citations,
      briefDate: '2026-06-27',
    })
    expect(r.narrative).not.toBeNull()
  })
})

describe('callNarrativeWriter calendar injection', () => {
  it('narrative user content includes econ calendar when provided', async () => {
    vi.mocked(callAgentLLM).mockResolvedValueOnce(VALID_NARRATIVE)
    await callNarrativeWriter({
      brief: FAKE_BRIEF,
      analystOutputs: FAKE_ANALYSTS,
      news: FAKE_NEWS,
      citations: FAKE_BRIEF.citations,
      briefDate: '2026-06-27',
      calendarBlock: '## 本週財經行事曆\n- 2026-06-17：FOMC 利率決策（US、high）',
    })
    const args = vi.mocked(callAgentLLM).mock.calls[0]?.[0]
    expect(args?.userContent).toContain('# 行事曆參考（前瞻素材；只可引用列出的事件與日期）')
    expect(args?.userContent).toContain('## 本週財經行事曆')
  })

  it('narrative user content omits calendar section when null', async () => {
    vi.mocked(callAgentLLM).mockResolvedValueOnce(VALID_NARRATIVE)
    await callNarrativeWriter({
      brief: FAKE_BRIEF,
      analystOutputs: FAKE_ANALYSTS,
      news: FAKE_NEWS,
      citations: FAKE_BRIEF.citations,
      briefDate: '2026-06-27',
      calendarBlock: null,
    })
    const args = vi.mocked(callAgentLLM).mock.calls[0]?.[0]
    expect(args?.userContent).not.toContain('行事曆參考')
  })
})

describe('callNarrativeWriter market snapshot injection', () => {
  it('narrative user content includes market snapshot when provided', async () => {
    vi.mocked(callAgentLLM).mockResolvedValueOnce(VALID_NARRATIVE)
    await callNarrativeWriter({
      brief: FAKE_BRIEF,
      analystOutputs: FAKE_ANALYSTS,
      news: FAKE_NEWS,
      citations: FAKE_BRIEF.citations,
      briefDate: '2026-06-27',
      marketSnapshot: '## 今日市場數據\n- 加權指數：23,150 點（+0.8%）',
    })
    const args = vi.mocked(callAgentLLM).mock.calls[0]?.[0]
    expect(args?.userContent).toContain('# 市場數據參考')
    expect(args?.userContent).toContain('## 今日市場數據')
    expect(args?.userContent).toContain('23,150')
  })

  it('narrative user content omits market snapshot section when null', async () => {
    vi.mocked(callAgentLLM).mockResolvedValueOnce(VALID_NARRATIVE)
    await callNarrativeWriter({
      brief: FAKE_BRIEF,
      analystOutputs: FAKE_ANALYSTS,
      news: FAKE_NEWS,
      citations: FAKE_BRIEF.citations,
      briefDate: '2026-06-27',
      marketSnapshot: null,
    })
    const args = vi.mocked(callAgentLLM).mock.calls[0]?.[0]
    expect(args?.userContent).not.toContain('市場數據參考')
  })
})

describe('callNarrativeWriter storyline injection', () => {
  it('narrative user content includes storyline block when provided', async () => {
    vi.mocked(callAgentLLM).mockResolvedValueOnce(VALID_NARRATIVE)
    await callNarrativeWriter({
      brief: FAKE_BRIEF,
      analystOutputs: FAKE_ANALYSTS,
      news: FAKE_NEWS,
      citations: FAKE_BRIEF.citations,
      briefDate: '2026-06-27',
      storylineBlock: '## 追蹤線\n- 半導體出口管制：本週新增禁令',
    })
    const args = vi.mocked(callAgentLLM).mock.calls[0]?.[0]
    expect(args?.userContent).toContain('# 敘事線參考（依「跨日連續性」節處理：只在真有延續的主線講今日相對「先前」的 delta 與伏筆兌現；無延續勿硬提、稀疏日冷開場）')
    expect(args?.userContent).toContain('## 追蹤線')
  })

  it('narrative user content omits storyline section when null', async () => {
    vi.mocked(callAgentLLM).mockResolvedValueOnce(VALID_NARRATIVE)
    await callNarrativeWriter({
      brief: FAKE_BRIEF,
      analystOutputs: FAKE_ANALYSTS,
      news: FAKE_NEWS,
      citations: FAKE_BRIEF.citations,
      briefDate: '2026-06-27',
      storylineBlock: null,
    })
    const args = vi.mocked(callAgentLLM).mock.calls[0]?.[0]
    expect(args?.userContent).not.toContain('敘事線參考')
  })
})

describe('callNarrativeWriter mainThemes injection', () => {
  it('user content includes mainThemes when provided', async () => {
    vi.mocked(callAgentLLM).mockResolvedValueOnce(VALID_NARRATIVE)
    await callNarrativeWriter({ brief: FAKE_BRIEF, analystOutputs: FAKE_ANALYSTS, news: FAKE_NEWS, citations: FAKE_BRIEF.citations, briefDate: '2026-06-27', mainThemes: ['Fed 政策轉向', '半導體景氣'] })
    const args = vi.mocked(callAgentLLM).mock.calls[0]?.[0]
    expect(args?.userContent).toContain('當日主軸')
    expect(args?.userContent).toContain('Fed 政策轉向')
  })
  it('user content instructs self-derive when mainThemes absent', async () => {
    vi.mocked(callAgentLLM).mockResolvedValueOnce(VALID_NARRATIVE)
    await callNarrativeWriter({ brief: FAKE_BRIEF, analystOutputs: FAKE_ANALYSTS, news: FAKE_NEWS, citations: FAKE_BRIEF.citations, briefDate: '2026-06-27' })
    const args = vi.mocked(callAgentLLM).mock.calls[0]?.[0]
    expect(args?.userContent).toContain('自行從下列選稿歸納')
  })
})

describe('callNarrativeWriter dailyThesis injection', () => {
  it('user content includes dailyThesis under 本日論點 when provided', async () => {
    vi.mocked(callAgentLLM).mockResolvedValueOnce(VALID_NARRATIVE)
    await callNarrativeWriter({ brief: FAKE_BRIEF, analystOutputs: FAKE_ANALYSTS, news: FAKE_NEWS, citations: FAKE_BRIEF.citations, briefDate: '2026-06-27', dailyThesis: 'AI 算力需求拉動封測鏈是今日主線' })
    const args = vi.mocked(callAgentLLM).mock.calls[0]?.[0]
    expect(args?.userContent).toContain('本日論點')
    expect(args?.userContent).toContain('AI 算力需求拉動封測鏈是今日主線')
  })
  it('user content omits 本日論點 block when dailyThesis absent', async () => {
    vi.mocked(callAgentLLM).mockResolvedValueOnce(VALID_NARRATIVE)
    await callNarrativeWriter({ brief: FAKE_BRIEF, analystOutputs: FAKE_ANALYSTS, news: FAKE_NEWS, citations: FAKE_BRIEF.citations, briefDate: '2026-06-27' })
    const args = vi.mocked(callAgentLLM).mock.calls[0]?.[0]
    expect(args?.userContent).not.toContain('本日論點')
  })
})

describe('callNarrativeWriter temporal framing', () => {
  it('每則新聞前注入發布相對時間 + header 用 briefDate（非 new Date）', async () => {
    vi.mocked(callAgentLLM).mockResolvedValueOnce(VALID_NARRATIVE)
    const news = [{ id: 'n1', title: '台股大跌', url: 'https://example.com/a', text: '台股今日重挫', publishedAt: '2026-06-26T06:37:00Z' }]
    const analysts = [{ newsId: 'n1', primaryImpact: 'x', cascadeChains: [], reasoning: 'r' }]
    await callNarrativeWriter({
      brief: FAKE_BRIEF,
      analystOutputs: analysts,
      news,
      citations: FAKE_BRIEF.citations,
      briefDate: '2026-06-27',
    })
    const uc = vi.mocked(callAgentLLM).mock.calls[0]?.[0]?.userContent ?? ''
    expect(uc).toContain('發布時間：昨日') // publishedAt 台北 6/26 對報告日 6/27
    expect(uc).toContain('今天 2026-06-27') // header 用 briefDate、非 wall-clock
  })
  it('注入市場收盤時間框架 block', async () => {
    vi.mocked(callAgentLLM).mockResolvedValueOnce(VALID_NARRATIVE)
    const news = [{ id: 'n1', title: '台股大跌', url: 'https://example.com/a', text: '台股今日重挫', publishedAt: '2026-06-26T06:37:00Z' }]
    const analysts = [{ newsId: 'n1', primaryImpact: 'x', cascadeChains: [], reasoning: 'r' }]
    await callNarrativeWriter({
      brief: FAKE_BRIEF,
      analystOutputs: analysts,
      news,
      citations: FAKE_BRIEF.citations,
      briefDate: '2026-06-27',
      marketCloseFraming: buildMarketCloseFraming('2026-06-26', '2026-06-27'),
    })
    const uc = vi.mocked(callAgentLLM).mock.calls[0]?.[0]?.userContent ?? ''
    expect(uc).toContain('市場收盤時間框架')
    expect(uc).toContain('台股（加權指數）最近收盤：昨日')
  })
})

describe('callNarrativeWriter weekend mode', () => {
  it('weekend 時 user content 含本週回顧、system prompt 用 weekend', async () => {
    vi.mocked(callAgentLLM).mockResolvedValueOnce(VALID_NARRATIVE)
    await callNarrativeWriter({
      brief: FAKE_BRIEF,
      analystOutputs: FAKE_ANALYSTS,
      news: FAKE_NEWS,
      citations: FAKE_BRIEF.citations,
      briefDate: '2026-07-12',
      reportKind: 'weekend',
      weeklyRecapBlock: '## 本週敘事線回顧\n- 【AI 去槓桿】論點：疑慮\n  2026-07-08（支持）：升溫',
    })
    const args = vi.mocked(callAgentLLM).mock.calls[0]?.[0]
    expect(args?.userContent).toContain('本週敘事線回顧')
    expect(args?.systemPrompt).toContain('下週前瞻') // 用 weekend prompt
  })

  it('weekday（預設）用日報 prompt、不含週末結構', async () => {
    vi.mocked(callAgentLLM).mockResolvedValueOnce(VALID_NARRATIVE)
    await callNarrativeWriter({
      brief: FAKE_BRIEF,
      analystOutputs: FAKE_ANALYSTS,
      news: FAKE_NEWS,
      citations: FAKE_BRIEF.citations,
      briefDate: '2026-07-10',
    })
    const args = vi.mocked(callAgentLLM).mock.calls[0]?.[0]
    expect(args?.systemPrompt).not.toContain('下週前瞻')
  })
})

// section 的 claimIds 只保留 ledger 內的 id，未知 id strip 掉並記數。
// strip 而非整份失敗——比照既有的 fabricationStripped，degrade 粒度是這個 id、不是整篇。
describe('callNarrativeWriter claimIds', () => {
  const LEDGER: EvidenceClaim[] = [
    { id: 'c1', kind: 'fact', claimType: 'named-number', claim: '台股收在 22,150 點', evidenceRefs: [], asOf: '2026-06-26', checks: [] },
    { id: 'c2', kind: 'inference', claimType: 'causal', claim: '外資賣超壓抑指數', evidenceRefs: [], asOf: '2026-06-26', checks: [] },
  ]
  function narrativeWithClaimIds(first: string[], second: string[]) {
    return {
      ...VALID_NARRATIVE,
      sections: [
        { ...VALID_NARRATIVE.sections[0], claimIds: first },
        { ...VALID_NARRATIVE.sections[1], claimIds: second },
      ],
    }
  }

  it('keeps ledger ids and reports 0 stripped', async () => {
    vi.mocked(callAgentLLM).mockResolvedValueOnce(narrativeWithClaimIds(['c1'], ['c2']))
    const result = await callNarrativeWriter({
      brief: FAKE_BRIEF,
      analystOutputs: FAKE_ANALYSTS,
      news: FAKE_NEWS,
      citations: FAKE_BRIEF.citations,
      briefDate: '2026-06-27',
      claimLedger: LEDGER,
    })
    expect(result.narrative?.sections[0]?.claimIds).toEqual(['c1'])
    expect(result.narrative?.sections[1]?.claimIds).toEqual(['c2'])
    expect(result.audit.claimIdsStripped).toBe(0)
  })

  it('strips ids missing from the ledger and counts them in audit', async () => {
    vi.mocked(callAgentLLM).mockResolvedValueOnce(narrativeWithClaimIds(['c1', 'c99'], ['c7']))
    const result = await callNarrativeWriter({
      brief: FAKE_BRIEF,
      analystOutputs: FAKE_ANALYSTS,
      news: FAKE_NEWS,
      citations: FAKE_BRIEF.citations,
      briefDate: '2026-06-27',
      claimLedger: LEDGER,
    })
    expect(result.narrative?.sections[0]?.claimIds).toEqual(['c1'])
    expect(result.narrative?.sections[1]?.claimIds).toEqual([])
    expect(result.audit.claimIdsStripped).toBe(2)
  })

  it('treats an absent ledger as empty（旗標關閉／當日無 claim 時全 strip、不整份失敗）', async () => {
    vi.mocked(callAgentLLM).mockResolvedValueOnce(narrativeWithClaimIds(['c1'], ['c2']))
    const result = await callNarrativeWriter({
      brief: FAKE_BRIEF,
      analystOutputs: FAKE_ANALYSTS,
      news: FAKE_NEWS,
      citations: FAKE_BRIEF.citations,
      briefDate: '2026-06-27',
    })
    expect(result.narrative).toBeTruthy()
    expect(result.narrative?.sections[0]?.claimIds).toEqual([])
    expect(result.audit.claimIdsStripped).toBe(2)
  })

  it('defaults claimIds to [] when the model omits them', async () => {
    vi.mocked(callAgentLLM).mockResolvedValueOnce(VALID_NARRATIVE)
    const result = await callNarrativeWriter({
      brief: FAKE_BRIEF,
      analystOutputs: FAKE_ANALYSTS,
      news: FAKE_NEWS,
      citations: FAKE_BRIEF.citations,
      briefDate: '2026-06-27',
      claimLedger: LEDGER,
    })
    expect(result.narrative?.sections[0]?.claimIds).toEqual([])
    expect(result.audit.claimIdsStripped).toBe(0)
  })

  it('reports 0 stripped on the degrade path', async () => {
    vi.mocked(callAgentLLM)
      .mockResolvedValueOnce({ ...VALID_NARRATIVE, intro: 'short' })
      .mockResolvedValueOnce({ ...VALID_NARRATIVE, intro: 'short' })
    const result = await callNarrativeWriter({
      brief: FAKE_BRIEF,
      analystOutputs: FAKE_ANALYSTS,
      news: FAKE_NEWS,
      citations: FAKE_BRIEF.citations,
      briefDate: '2026-06-27',
      claimLedger: LEDGER,
    })
    expect(result.narrative).toBeNull()
    expect(result.audit.claimIdsStripped).toBe(0)
  })

  it('reports the successful attempt count, not an accumulation across retries', async () => {
    // retry 是 prod 常態，正是 claimIdsStripped 最容易被寫成跨 attempt 累加而沒人察覺的路徑
    vi.mocked(callAgentLLM)
      .mockResolvedValueOnce({ ...narrativeWithClaimIds(['x1', 'x2', 'x3'], ['x4']), intro: 'short' })
      .mockResolvedValueOnce(narrativeWithClaimIds(['c1', 'nope'], ['c2']))
    const result = await callNarrativeWriter({
      brief: FAKE_BRIEF,
      analystOutputs: FAKE_ANALYSTS,
      news: FAKE_NEWS,
      citations: FAKE_BRIEF.citations,
      briefDate: '2026-06-27',
      claimLedger: LEDGER,
    })
    expect(result.narrative).toBeTruthy()
    expect(callAgentLLM).toHaveBeenCalledTimes(2)
    // 第一次 attempt strip 了 4 個、第二次 1 個 → 只回第二次的
    expect(result.audit.claimIdsStripped).toBe(1)
  })

  it('emits the strip count on the audit LlmCallRecord', async () => {
    vi.mocked(callAgentLLM).mockResolvedValueOnce(narrativeWithClaimIds(['c1', 'nope'], ['c2']))
    const records: LlmCallRecord[] = []
    await callNarrativeWriter({
      brief: FAKE_BRIEF,
      analystOutputs: FAKE_ANALYSTS,
      news: FAKE_NEWS,
      citations: FAKE_BRIEF.citations,
      briefDate: '2026-06-27',
      claimLedger: LEDGER,
      onCallRecord: r => records.push(r),
    })
    expect(records.at(-1)?.narrativeClaimIdsStripped).toBe(1)
  })

  // 2026-08-09 prod 缺陷的最小重現：section 掛了 c1，body 卻用了 c1 沒有的數字。
  // 這兩個 audit 欄位是 gate 的唯一 prod 出口，沒有斷言就等於沒接上。
  it('emits the claim-binding counts on the audit LlmCallRecord', async () => {
    const withNumbers = {
      ...VALID_NARRATIVE,
      sections: [
        { ...VALID_NARRATIVE.sections[0], body: `${'a'.repeat(280)}台股收在 22,150 點，另有 44226 點。`, claimIds: ['c1'] },
        { ...VALID_NARRATIVE.sections[1], claimIds: ['c2'] },
      ],
    }
    vi.mocked(callAgentLLM).mockResolvedValueOnce(withNumbers)
    const records: LlmCallRecord[] = []
    const result = await callNarrativeWriter({
      brief: FAKE_BRIEF,
      analystOutputs: FAKE_ANALYSTS,
      news: FAKE_NEWS,
      citations: FAKE_BRIEF.citations,
      briefDate: '2026-06-27',
      claimLedger: LEDGER,
      onCallRecord: r => records.push(r),
    })
    // 22,150 對回 c1、44226 對不回任何本段掛的 claim
    expect(records.at(-1)?.narrativeClaimCheckedNumbers).toBe(2)
    expect(records.at(-1)?.narrativeClaimUnboundNumbers).toBe(1)
    // 軟警告：不擋 pipeline、narrative 照樣產出
    expect(result.narrative).toBeTruthy()
  })
})

// section 的 citationUrls 由它所用 claim 的 citation ref 反推。
// 這裡驗的是 wrapper 層的接線與 audit 傳遞；三條路的窮舉在 narrative-writer.normalize.test.ts。
describe('callNarrativeWriter citationUrls 反推', () => {
  function claimWith(id: string, urls: string[]): EvidenceClaim {
    return {
      id,
      kind: 'fact',
      claimType: 'named-number',
      claim: `claim ${id}`,
      evidenceRefs: urls.map(url => ({ kind: 'citation' as const, url })),
      asOf: '2026-06-26',
      checks: [],
    }
  }
  function narrativeWithClaimIds(first: string[], second: string[]) {
    return {
      ...VALID_NARRATIVE,
      sections: [
        { ...VALID_NARRATIVE.sections[0], claimIds: first },
        { ...VALID_NARRATIVE.sections[1], claimIds: second },
      ],
    }
  }

  it('由 claim 的 ref 覆蓋模型挑的 url，並回報反推的 section 數', async () => {
    // 模型 section 0 挑了 /a、section 1 挑了 /b；claim 說 section 0 的依據是 /b
    vi.mocked(callAgentLLM).mockResolvedValueOnce(narrativeWithClaimIds(['c1'], []))
    const result = await callNarrativeWriter({
      brief: FAKE_BRIEF,
      analystOutputs: FAKE_ANALYSTS,
      news: FAKE_NEWS,
      citations: FAKE_BRIEF.citations,
      briefDate: '2026-06-27',
      claimLedger: [claimWith('c1', ['https://example.com/b'])],
    })
    expect(result.narrative?.sections[0]?.citationUrls).toEqual(['https://example.com/b'])
    expect(result.narrative?.sections[1]?.citationUrls).toEqual(['https://example.com/b'])
    expect(result.audit.claimCitationSections).toBe(1)
    expect(result.audit.claimCitationUrlsDropped).toBe(0)
  })

  it('claim 的 url 不在 citations 時退回模型挑選並計數', async () => {
    vi.mocked(callAgentLLM).mockResolvedValueOnce(narrativeWithClaimIds(['c1'], []))
    const result = await callNarrativeWriter({
      brief: FAKE_BRIEF,
      analystOutputs: FAKE_ANALYSTS,
      news: FAKE_NEWS,
      citations: FAKE_BRIEF.citations,
      briefDate: '2026-06-27',
      claimLedger: [claimWith('c1', ['https://evil.example.com/x'])],
    })
    // 退回模型原本挑的 /a，而不是被 fallback 換成不相干的來源
    expect(result.narrative?.sections[0]?.citationUrls).toEqual(['https://example.com/a'])
    expect(result.audit.claimCitationSections).toBe(0)
    expect(result.audit.claimCitationUrlsDropped).toBe(1)
  })

  it('degrade 時兩個計數都是 0', async () => {
    vi.mocked(callAgentLLM)
      .mockResolvedValueOnce({ ...VALID_NARRATIVE, intro: 'short' })
      .mockResolvedValueOnce({ ...VALID_NARRATIVE, intro: 'short' })
    const result = await callNarrativeWriter({
      brief: FAKE_BRIEF,
      analystOutputs: FAKE_ANALYSTS,
      news: FAKE_NEWS,
      citations: FAKE_BRIEF.citations,
      briefDate: '2026-06-27',
      claimLedger: [claimWith('c1', ['https://example.com/b'])],
    })
    expect(result.narrative).toBeNull()
    expect(result.audit.claimCitationSections).toBe(0)
    expect(result.audit.claimCitationUrlsDropped).toBe(0)
  })

  it('把兩個計數 emit 到 LlmCallRecord', async () => {
    vi.mocked(callAgentLLM).mockResolvedValueOnce(narrativeWithClaimIds(['c1'], ['c2']))
    const records: LlmCallRecord[] = []
    await callNarrativeWriter({
      brief: FAKE_BRIEF,
      analystOutputs: FAKE_ANALYSTS,
      news: FAKE_NEWS,
      citations: FAKE_BRIEF.citations,
      briefDate: '2026-06-27',
      claimLedger: [claimWith('c1', ['https://example.com/b']), claimWith('c2', ['https://evil.example.com/x'])],
      onCallRecord: r => records.push(r),
    })
    expect(records.at(-1)?.narrativeClaimCitationSections).toBe(1)
    expect(records.at(-1)?.narrativeClaimCitationUrlsDropped).toBe(1)
  })
})

// ledger 進 prompt，由 NARRATIVE_LEDGER_ENABLED 控制。
// 旗標關閉時 systemPrompt 與 userContent 必須**逐字**與今日相同——這裡改壞、部署上去之後
// 排程觸發產出的報告就會用改過的 prompt 寫出來，而 canary 量不到 prompt 改動（過去有教訓）。
describe('callNarrativeWriter claim ledger prompt', () => {
  const LEDGER: EvidenceClaim[] = [
    {
      id: 'c1',
      kind: 'fact',
      claimType: 'named-number',
      claim: '費半收 11,430.35 點',
      evidenceRefs: [{ kind: 'series', seriesId: 'us-sox', asOf: '2026-06-26' }],
      asOf: '2026-06-26',
      checks: [],
    },
  ]

  beforeEach(() => {
    delete process.env.NARRATIVE_LEDGER_ENABLED
  })

  it('旗標未設時 systemPrompt 逐字不變、userContent 不含 ledger', async () => {
    vi.mocked(callAgentLLM).mockResolvedValueOnce(VALID_NARRATIVE)
    await callNarrativeWriter({
      brief: FAKE_BRIEF,
      analystOutputs: FAKE_ANALYSTS,
      news: FAKE_NEWS,
      citations: FAKE_BRIEF.citations,
      briefDate: '2026-06-27',
      claimLedger: LEDGER,
    })
    const args = vi.mocked(callAgentLLM).mock.calls[0]?.[0]
    expect(args?.systemPrompt).toBe(NARRATIVE_WRITER_SYSTEM_PROMPT)
    expect(args?.userContent).not.toContain('c1')
    expect(args?.userContent).not.toContain('已核對的證據')
  })

  it('只有字串 true 才算開（對齊 ANALYST_CLAIMS_ENABLED 慣例）', async () => {
    for (const v of ['1', 'yes', 'TRUE', '']) {
      vi.mocked(callAgentLLM).mockReset()
      vi.mocked(callAgentLLM).mockResolvedValueOnce(VALID_NARRATIVE)
      process.env.NARRATIVE_LEDGER_ENABLED = v
      await callNarrativeWriter({
        brief: FAKE_BRIEF,
        analystOutputs: FAKE_ANALYSTS,
        news: FAKE_NEWS,
        citations: FAKE_BRIEF.citations,
        briefDate: '2026-06-27',
        claimLedger: LEDGER,
      })
      expect(vi.mocked(callAgentLLM).mock.calls[0]?.[0]?.systemPrompt).toBe(NARRATIVE_WRITER_SYSTEM_PROMPT)
    }
  })

  it('旗標開時 ledger 進 userContent、systemPrompt 帶 claimIds 指示與 few-shot', async () => {
    process.env.NARRATIVE_LEDGER_ENABLED = 'true'
    vi.mocked(callAgentLLM).mockResolvedValueOnce(VALID_NARRATIVE)
    await callNarrativeWriter({
      brief: FAKE_BRIEF,
      analystOutputs: FAKE_ANALYSTS,
      news: FAKE_NEWS,
      citations: FAKE_BRIEF.citations,
      briefDate: '2026-06-27',
      claimLedger: LEDGER,
    })
    const args = vi.mocked(callAgentLLM).mock.calls[0]?.[0]
    expect(args?.userContent).toContain('[c1] (fact/named-number) 費半收 11,430.35 點')
    expect(args?.systemPrompt).toContain('claimIds')
    // few-shot 必須跟著指示一起改：只改指示不動 few-shot 等於沒改（本 repo 踩過）。
    // 斷言 few-shot **專屬**的字串——`"claimIds"` 光靠上面的輸出 schema 那行就成立，
    // 拿它當守衛的話 few-shot 整段被刪掉測試也會綠（獨立複查實測過）。
    expect(args?.systemPrompt).toContain('範例（few-shot、claimIds 版')
    expect(args?.systemPrompt).toContain('"claimIds": ["c3", "c7"]')
    expect(args?.systemPrompt.startsWith(NARRATIVE_WRITER_SYSTEM_PROMPT)).toBe(true)
  })

  it('旗標開但 ledger 為空時不進 prompt（不塞空殼）', async () => {
    process.env.NARRATIVE_LEDGER_ENABLED = 'true'
    vi.mocked(callAgentLLM).mockResolvedValueOnce(VALID_NARRATIVE)
    await callNarrativeWriter({
      brief: FAKE_BRIEF,
      analystOutputs: FAKE_ANALYSTS,
      news: FAKE_NEWS,
      citations: FAKE_BRIEF.citations,
      briefDate: '2026-06-27',
      claimLedger: [],
    })
    const args = vi.mocked(callAgentLLM).mock.calls[0]?.[0]
    expect(args?.systemPrompt).toBe(NARRATIVE_WRITER_SYSTEM_PROMPT)
    expect(args?.userContent).not.toContain('已核對的證據')
  })

  it('旗標開但 claimLedger 未提供時不進 prompt', async () => {
    process.env.NARRATIVE_LEDGER_ENABLED = 'true'
    vi.mocked(callAgentLLM).mockResolvedValueOnce(VALID_NARRATIVE)
    await callNarrativeWriter({
      brief: FAKE_BRIEF,
      analystOutputs: FAKE_ANALYSTS,
      news: FAKE_NEWS,
      citations: FAKE_BRIEF.citations,
      briefDate: '2026-06-27',
    })
    expect(vi.mocked(callAgentLLM).mock.calls[0]?.[0]?.systemPrompt).toBe(NARRATIVE_WRITER_SYSTEM_PROMPT)
  })

  it('weekend prompt 也接得上 ledger 指示', async () => {
    process.env.NARRATIVE_LEDGER_ENABLED = 'true'
    vi.mocked(callAgentLLM).mockResolvedValueOnce(VALID_NARRATIVE)
    await callNarrativeWriter({
      brief: FAKE_BRIEF,
      analystOutputs: FAKE_ANALYSTS,
      news: FAKE_NEWS,
      citations: FAKE_BRIEF.citations,
      briefDate: '2026-07-12',
      reportKind: 'weekend',
      claimLedger: LEDGER,
    })
    const args = vi.mocked(callAgentLLM).mock.calls[0]?.[0]
    expect(args?.systemPrompt.startsWith(NARRATIVE_WRITER_WEEKEND_SYSTEM_PROMPT)).toBe(true)
    expect(args?.systemPrompt).toContain('claimIds')
  })
})
