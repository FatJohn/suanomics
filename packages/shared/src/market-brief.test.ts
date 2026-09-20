import { describe, expect, it } from 'vitest'
import { CascadeChainSchema, MarketBriefSchema, NarrativeSchema, NarrativeSectionSchema, ViewpointsSchema } from './market-brief.js'

const VALID: Record<string, unknown> = {
  headline: '川普宣布半導體關稅',
  summary: '影響亞洲供應鏈、台積電首當其衝',
  relatedNews: [{
    title: '相關：台股重挫',
    url: 'https://example.com/a',
    relationType: 'effect',
    reasoning: '外資觀望',
  }],
  affectedIndustries: [{
    name: '半導體',
    direction: 'negative',
    confidence: 'medium',
    reasoning: '關稅直接衝擊出口',
  }],
  relatedETFs: [{ ticker: '0050', name: '元大台灣50', rationale: '權值股集中半導體' }],
  reasoningChain: ['關稅宣布', '成本上升', '外資賣壓'],
  citations: [{ title: 't', url: 'https://example.com/s', quote: '半導體受衝擊' }],
  disclaimer: '本分析僅供參考、非投資建議、實際投資請諮詢專業人士',
}

describe('marketBriefSchema', () => {
  it('shouldAcceptMinimalValidPayload', () => {
    expect(() => MarketBriefSchema.parse(VALID)).not.toThrow()
  })

  it('shouldRejectHeadlineOver80Chars', () => {
    const bad = { ...VALID, headline: '一'.repeat(81) }
    expect(() => MarketBriefSchema.parse(bad)).toThrow()
  })

  it('shouldAcceptOptionalDailyThesisWithin10To150Chars', () => {
    const ok = { ...VALID, dailyThesis: '利率重新定價是今日跨市場波動的主要驅動因素' }
    expect(() => MarketBriefSchema.parse(ok)).not.toThrow()
  })

  it('shouldRejectDailyThesisShorterThan10Chars', () => {
    const bad = { ...VALID, dailyThesis: '太短論點' }
    expect(() => MarketBriefSchema.parse(bad)).toThrow()
  })

  it('shouldRejectDailyThesisLongerThan150Chars', () => {
    const bad = { ...VALID, dailyThesis: '一'.repeat(151) }
    expect(() => MarketBriefSchema.parse(bad)).toThrow()
  })

  it('shouldRejectRelatedNewsOver5Items', () => {
    const bad = { ...VALID, relatedNews: Array.from({ length: 6 }, (_, i) => ({ title: 't', url: `https://x/${i}`, relationType: 'effect', reasoning: 'r' })) }
    expect(() => MarketBriefSchema.parse(bad)).toThrow()
  })

  it('shouldRejectInvalidIndustryDirection', () => {
    const firstIndustry = (VALID.affectedIndustries as Array<Record<string, unknown>>)[0]
    const bad = { ...VALID, affectedIndustries: [{ ...firstIndustry, direction: 'bullish' }] }
    expect(() => MarketBriefSchema.parse(bad)).toThrow()
  })

  it('shouldRejectReasoningChainWithFewerThan2Steps', () => {
    const bad = { ...VALID, reasoningChain: ['only one'] }
    expect(() => MarketBriefSchema.parse(bad)).toThrow()
  })

  it('shouldAcceptCitationQuoteUpTo600Chars', () => {
    const ok = { ...VALID, citations: [{ title: 't', url: 'https://x', quote: '一'.repeat(600) }] }
    expect(() => MarketBriefSchema.parse(ok)).not.toThrow()
  })

  it('shouldRejectCitationQuoteOver600Chars', () => {
    const bad = { ...VALID, citations: [{ title: 't', url: 'https://x', quote: '一'.repeat(601) }] }
    expect(() => MarketBriefSchema.parse(bad)).toThrow()
  })

  it('shouldRejectEmptyCitations', () => {
    const bad = { ...VALID, citations: [] }
    expect(() => MarketBriefSchema.parse(bad)).toThrow()
  })

  it('shouldRejectDisclaimerOtherThanFixedString', () => {
    const bad = { ...VALID, disclaimer: '投資有風險' }
    expect(() => MarketBriefSchema.parse(bad)).toThrow()
  })

  it('shouldRejectNonUrlStringInCitation', () => {
    // 治本後 citation.url 強制真網址（內部 ID 在組裝層已 filter；schema 收口防回歸）
    const bad = { ...VALID, citations: [{ title: 't', url: 'news_us_iran_deal_nasdaq_surge', quote: 'q' }] }
    expect(() => MarketBriefSchema.parse(bad)).toThrow()
  })

  it('shouldAcceptDataInsufficientSentinelUrl', () => {
    // 零 citation 的 graceful sentinel（data: 合法 scheme、前端 isExternalUrl 擋顯示）
    const ok = { ...VALID, citations: [{ title: '資料不足', url: 'data:insufficient', quote: 'q' }] }
    expect(() => MarketBriefSchema.parse(ok)).not.toThrow()
  })

  it('shouldRejectNonUrlStringInRelatedNews', () => {
    const bad = { ...VALID, relatedNews: [{ title: 't', url: 'internal_id', relationType: 'effect', reasoning: 'r' }] }
    expect(() => MarketBriefSchema.parse(bad)).toThrow()
  })
})

describe('marketBriefSchema cascadeChains', () => {
  const baseBrief = VALID

  it('accepts brief without cascadeChains (cache compat)', () => {
    expect(MarketBriefSchema.safeParse(baseBrief).success).toBe(true)
  })

  it('accepts brief with empty cascadeChains', () => {
    expect(MarketBriefSchema.safeParse({ ...baseBrief, cascadeChains: [] }).success).toBe(true)
  })

  it('accepts brief with tier 1 + tier 2 chains', () => {
    const chains = [
      { chainId: 't1-0', tier: 1, industry: 'A', mechanism: 'm', affectedTickers: [], direction: 'positive', citations: [] },
      { chainId: 't2-0', tier: 2, parentChainId: 't1-0', industry: 'B', mechanism: 'm', affectedTickers: [], direction: 'positive', citations: [] },
    ]
    expect(MarketBriefSchema.safeParse({ ...baseBrief, cascadeChains: chains }).success).toBe(true)
  })
})

describe('cascadeChainSchema export', () => {
  const baseChain = {
    industry: 'i',
    mechanism: 'm',
    affectedTickers: [],
    direction: 'positive' as const,
    citations: [],
  }
  it('accepts a chain without tier metadata', () => {
    expect(CascadeChainSchema.safeParse(baseChain).success).toBe(true)
  })
  it('rejects tier 1 with parentChainId (refinement)', () => {
    expect(CascadeChainSchema.safeParse({ ...baseChain, chainId: 't1-0', tier: 1, parentChainId: 't1-99' }).success).toBe(false)
  })
  it('forceGroup 三種狀態都收：有值、null（歸不進任何一股力）、undefined（grouper 之前的舊 brief）', () => {
    expect(CascadeChainSchema.safeParse({ ...baseChain, forceGroup: '半導體與先進代工' }).success).toBe(true)
    expect(CascadeChainSchema.safeParse({ ...baseChain, forceGroup: null }).success).toBe(true)
    expect(CascadeChainSchema.safeParse(baseChain).success).toBe(true)
  })
  it('forceGroup 不收空字串——那是「標了但沒標到東西」，比 null 更難查', () => {
    expect(CascadeChainSchema.safeParse({ ...baseChain, forceGroup: '' }).success).toBe(false)
  })
  it('accepts optional speculative flag', () => {
    const parsed = CascadeChainSchema.safeParse({ ...baseChain, speculative: true })
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.speculative).toBe(true)
  })
})

// Long-form narrative 主題式 schemas
describe('narrativeSectionSchema (主題式)', () => {
  const VALID_SECTION = {
    heading: 'AI 科技與評價調整',
    body: 'a'.repeat(300),
    relatedNewsIds: ['n1'],
    citationUrls: ['https://example.com/a'],
  }
  it('accepts valid section', () => {
    expect(() => NarrativeSectionSchema.parse(VALID_SECTION)).not.toThrow()
  })
  it('rejects body < 250', () => {
    expect(() => NarrativeSectionSchema.parse({ ...VALID_SECTION, body: 'a'.repeat(249) })).toThrow()
  })
  it('accepts body up to 800', () => {
    expect(() => NarrativeSectionSchema.parse({ ...VALID_SECTION, body: 'a'.repeat(800) })).not.toThrow()
  })
  it('rejects body > 800', () => {
    expect(() => NarrativeSectionSchema.parse({ ...VALID_SECTION, body: 'a'.repeat(801) })).toThrow()
  })
  it('rejects empty heading', () => {
    expect(() => NarrativeSectionSchema.parse({ ...VALID_SECTION, heading: '' })).toThrow()
  })
  it('rejects heading > 40', () => {
    expect(() => NarrativeSectionSchema.parse({ ...VALID_SECTION, heading: 'a'.repeat(41) })).toThrow()
  })
  it('relatedNewsIds defaults to [] when omitted', () => {
    const { relatedNewsIds, ...noRel } = VALID_SECTION
    const parsed = NarrativeSectionSchema.parse(noRel)
    expect(parsed.relatedNewsIds).toEqual([])
  })
  it('rejects citationUrls = []', () => {
    expect(() => NarrativeSectionSchema.parse({ ...VALID_SECTION, citationUrls: [] })).toThrow()
  })

  // 本段引用的 claim ledger id（traceability）。比照 relatedNewsIds 的
  // .default([])——舊 brief 沒這欄位、下游拿到的一律是陣列而非 undefined。
  describe('claimIds（claim ledger traceability）', () => {
    it('defaults to [] when omitted (舊 brief 不重生也能解析)', () => {
      expect(NarrativeSectionSchema.parse(VALID_SECTION).claimIds).toEqual([])
    })
    it('accepts claim ids', () => {
      const parsed = NarrativeSectionSchema.parse({ ...VALID_SECTION, claimIds: ['c1', 'c7'] })
      expect(parsed.claimIds).toEqual(['c1', 'c7'])
    })
    it('accepts up to 8', () => {
      const ids = Array.from({ length: 8 }, (_, i) => `c${i + 1}`)
      expect(() => NarrativeSectionSchema.parse({ ...VALID_SECTION, claimIds: ids })).not.toThrow()
    })
    it('rejects > 8', () => {
      const ids = Array.from({ length: 9 }, (_, i) => `c${i + 1}`)
      expect(() => NarrativeSectionSchema.parse({ ...VALID_SECTION, claimIds: ids })).toThrow()
    })
    it('rejects empty-string id（normalize 沒做事、不是合法值）', () => {
      expect(() => NarrativeSectionSchema.parse({ ...VALID_SECTION, claimIds: [''] })).toThrow()
    })
  })
  it('rejects citationUrls.length > 3', () => {
    expect(() => NarrativeSectionSchema.parse({ ...VALID_SECTION, citationUrls: ['a', 'b', 'c', 'd'] })).toThrow()
  })

  // 讀者面「一句話結論」：舊 brief 沒這欄位、版面必須承受 null（比照 viewpoints 的 degrade）
  describe('takeaway（一句話結論）', () => {
    it('defaults to null when omitted (舊 row 不重生也能解析)', () => {
      expect(NarrativeSectionSchema.parse(VALID_SECTION).takeaway).toBeNull()
    })
    it('accepts explicit null', () => {
      expect(NarrativeSectionSchema.parse({ ...VALID_SECTION, takeaway: null }).takeaway).toBeNull()
    })
    it('accepts a one-sentence takeaway', () => {
      const t = '紅海衝突讓油價地緣溢價沒有如預期消退，WTI 撐在 84.38 美元。'
      expect(NarrativeSectionSchema.parse({ ...VALID_SECTION, takeaway: t }).takeaway).toBe(t)
    })
    it('rejects empty string（空字串是 normalize 沒做事、不是合法值）', () => {
      expect(() => NarrativeSectionSchema.parse({ ...VALID_SECTION, takeaway: '' })).toThrow()
    })
    it('accepts up to 70（安全天花板、刻意高於 prompt 目標 25-45）', () => {
      expect(() => NarrativeSectionSchema.parse({ ...VALID_SECTION, takeaway: 'a'.repeat(70) })).not.toThrow()
    })
    it('rejects > 70', () => {
      expect(() => NarrativeSectionSchema.parse({ ...VALID_SECTION, takeaway: 'a'.repeat(71) })).toThrow()
    })
  })
})

describe('narrativeSchema (主題式)', () => {
  const SECTION = {
    heading: '主題一',
    body: 'a'.repeat(300),
    relatedNewsIds: ['n1'],
    citationUrls: ['https://example.com/a'],
  }
  const VALID_NARRATIVE: unknown = {
    intro: 'a'.repeat(150),
    sections: [SECTION],
    outro: 'a'.repeat(150),
  }
  it('accepts valid narrative (1 section ok)', () => {
    expect(() => NarrativeSchema.parse(VALID_NARRATIVE)).not.toThrow()
  })
  it('rejects intro < 120', () => {
    expect(() => NarrativeSchema.parse({ ...(VALID_NARRATIVE as object), intro: 'a'.repeat(119) })).toThrow()
  })
  it('accepts intro up to 320', () => {
    expect(() => NarrativeSchema.parse({ ...(VALID_NARRATIVE as object), intro: 'a'.repeat(320) })).not.toThrow()
  })
  it('rejects intro > 320', () => {
    expect(() => NarrativeSchema.parse({ ...(VALID_NARRATIVE as object), intro: 'a'.repeat(321) })).toThrow()
  })
  it('rejects sections empty', () => {
    expect(() => NarrativeSchema.parse({ ...(VALID_NARRATIVE as object), sections: [] })).toThrow()
  })
  it('accepts sections up to 4', () => {
    const four = Array.from({ length: 4 }).fill(SECTION)
    expect(() => NarrativeSchema.parse({ ...(VALID_NARRATIVE as object), sections: four })).not.toThrow()
  })
  it('rejects sections > 4', () => {
    const five = Array.from({ length: 5 }).fill(SECTION)
    expect(() => NarrativeSchema.parse({ ...(VALID_NARRATIVE as object), sections: five })).toThrow()
  })
  it('rejects outro > 320', () => {
    expect(() => NarrativeSchema.parse({ ...(VALID_NARRATIVE as object), outro: 'a'.repeat(321) })).toThrow()
  })
  it('accepts outro up to 320', () => {
    expect(() => NarrativeSchema.parse({ ...(VALID_NARRATIVE as object), outro: 'a'.repeat(320) })).not.toThrow()
  })
  it('rejects outro < 120', () => {
    expect(() => NarrativeSchema.parse({ ...(VALID_NARRATIVE as object), outro: 'a'.repeat(119) })).toThrow()
  })
})

describe('marketBriefSchema · narrative + newsTitlesById', () => {
  const NARRATIVE_VALID = {
    intro: 'a'.repeat(150),
    sections: [
      { heading: '主題一', body: 'a'.repeat(300), relatedNewsIds: ['n1'], citationUrls: ['https://example.com/a'] },
      { heading: '主題二', body: 'a'.repeat(300), relatedNewsIds: ['n2'], citationUrls: ['https://example.com/b'] },
    ],
    outro: 'a'.repeat(150),
  }
  const briefBase = (extra: Record<string, unknown> = {}): unknown => ({
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
    ...extra,
  })

  it('accepts brief with narrative', () => {
    expect(() => MarketBriefSchema.parse(briefBase({ narrative: NARRATIVE_VALID }))).not.toThrow()
  })
  it('accepts brief with narrative=null (graceful degrade marker)', () => {
    expect(() => MarketBriefSchema.parse(briefBase({ narrative: null }))).not.toThrow()
  })
  it('accepts brief without narrative (backward compat)', () => {
    expect(() => MarketBriefSchema.parse(briefBase())).not.toThrow()
  })
  it('accepts newsTitlesById map', () => {
    expect(() => MarketBriefSchema.parse(briefBase({
      narrative: NARRATIVE_VALID,
      newsTitlesById: { n1: '日月光新聞', n2: 'AVGO 新聞' },
    }))).not.toThrow()
  })
  it('rejects narrative.sections[i].citationUrls 含 unknown url（superRefine）', () => {
    const bad = {
      ...NARRATIVE_VALID,
      sections: [
        { heading: '主題一', body: 'a'.repeat(300), relatedNewsIds: ['n1'], citationUrls: ['https://unknown.example.com/x'] },
        { heading: '主題二', body: 'a'.repeat(300), relatedNewsIds: ['n2'], citationUrls: ['https://example.com/b'] },
      ],
    }
    expect(() => MarketBriefSchema.parse(briefBase({ narrative: bad }))).toThrow(/unknown citation url/)
  })
  it('passes superRefine when narrative is null', () => {
    expect(() => MarketBriefSchema.parse(briefBase({ narrative: null }))).not.toThrow()
  })
})

// ── Viewpoints Block（顯性正反觀點）──
describe('viewpointsSchema', () => {
  const VALID_VP = {
    supportPoints: ['先進製程訂單能見度延伸至 2026', '出口連三月雙位數成長'],
    riskPoints: ['融資餘額逆勢增 390 億、槓桿未去化', '費半前瞻本益比逾 50 倍'],
    netRead: 'a'.repeat(150),
  }
  it('accepts valid viewpoints', () => {
    expect(() => ViewpointsSchema.parse(VALID_VP)).not.toThrow()
  })
  it('rejects fewer than 2 support points', () => {
    expect(() => ViewpointsSchema.parse({ ...VALID_VP, supportPoints: ['只有一點'] })).toThrow()
  })
  it('rejects more than 4 risk points', () => {
    expect(() => ViewpointsSchema.parse({ ...VALID_VP, riskPoints: ['a', 'b', 'c', 'd', 'e'] })).toThrow()
  })
  it('rejects a point over 120 chars', () => {
    expect(() => ViewpointsSchema.parse({ ...VALID_VP, supportPoints: ['一'.repeat(121), '正常一點'] })).toThrow()
  })
  it('rejects netRead under 120 chars', () => {
    expect(() => ViewpointsSchema.parse({ ...VALID_VP, netRead: 'a'.repeat(119) })).toThrow()
  })
  it('accepts netRead up to 360 chars', () => {
    expect(() => ViewpointsSchema.parse({ ...VALID_VP, netRead: 'a'.repeat(360) })).not.toThrow()
  })
  it('rejects netRead over 360 chars', () => {
    expect(() => ViewpointsSchema.parse({ ...VALID_VP, netRead: 'a'.repeat(361) })).toThrow()
  })
})

describe('marketBriefSchema · viewpoints', () => {
  const briefBase = (extra: Record<string, unknown> = {}): unknown => ({
    headline: 'h',
    summary: 's',
    relatedNews: [],
    affectedIndustries: [],
    relatedETFs: [],
    reasoningChain: ['r1', 'r2'],
    citations: [{ url: 'https://example.com/a', title: 't', quote: 'q' }],
    disclaimer: '本分析僅供參考、非投資建議、實際投資請諮詢專業人士',
    ...extra,
  })
  const VALID_VP = {
    supportPoints: ['支持一', '支持二'],
    riskPoints: ['風險一', '風險二'],
    netRead: 'a'.repeat(150),
  }
  it('accepts brief with viewpoints', () => {
    expect(() => MarketBriefSchema.parse(briefBase({ viewpoints: VALID_VP }))).not.toThrow()
  })
  it('accepts brief with viewpoints=null (graceful degrade)', () => {
    expect(() => MarketBriefSchema.parse(briefBase({ viewpoints: null }))).not.toThrow()
  })
  it('accepts brief without viewpoints (backward compat)', () => {
    expect(() => MarketBriefSchema.parse(briefBase())).not.toThrow()
  })

  // ledger 落地。相容性是這個欄位唯一的風險——既有 brief 全部沒有它。
  describe('claimLedger', () => {
    const VALID_CLAIM = {
      id: 'c1',
      kind: 'fact',
      claimType: 'named-number',
      claim: '費半收 11,430.35 點',
      evidenceRefs: [{ kind: 'series', seriesId: 'us-sox', asOf: '2026-08-07' }],
      asOf: '2026-08-07',
      checks: [],
    }
    it('accepts brief without claimLedger (backward compat)', () => {
      expect(() => MarketBriefSchema.parse(briefBase())).not.toThrow()
    })
    it('accepts empty claimLedger（當日沒有 claim，例如產出旗標關閉）', () => {
      expect(() => MarketBriefSchema.parse(briefBase({ claimLedger: [] }))).not.toThrow()
    })
    it('accepts brief with claimLedger', () => {
      const parsed = MarketBriefSchema.parse(briefBase({ claimLedger: [VALID_CLAIM] }))
      expect(parsed.claimLedger?.[0]?.id).toBe('c1')
    })
    it('rejects claim with a malformed evidenceRef', () => {
      const bad = { ...VALID_CLAIM, evidenceRefs: [{ kind: 'series', seriesId: 'us-sox' }] }
      expect(() => MarketBriefSchema.parse(briefBase({ claimLedger: [bad] }))).toThrow()
    })
  })
})
