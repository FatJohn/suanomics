import type { MarketBrief } from '@suanomics/shared'
import type { RawAnalysis } from './analyzer.js'
import { MarketBriefDisclaimer, MarketBriefSchema } from '@suanomics/shared'
import { describe, expect, it } from 'vitest'
import { adaptAnalystToMarketBrief, COMPLIANCE_STRIPPED_PLACEHOLDER, filterCitationsToAllowedUrls, finalizeAnalystToMarketBrief, finalizeBriefSafety, hashPrompt, INSUFFICIENT_CITATION_URL } from './analyzer.js'

describe('filterCitationsToAllowedUrls', () => {
  it('shouldKeepOnlyCitationsWhoseUrlIsInAllowedSet', () => {
    const raw: RawAnalysis = {
      headline: 'h',
      summary: 's',
      relatedNews: [],
      affectedIndustries: [],
      relatedETFs: [],
      reasoningChain: ['a', 'b'],
      citations: [
        { title: 't1', url: 'https://allowed.com/a', quote: 'q1' },
        { title: 't2', url: 'https://hallucinated.com/x', quote: 'q2' },
      ],
      disclaimer: '本分析僅供參考、非投資建議、實際投資請諮詢專業人士',
    }
    const out = filterCitationsToAllowedUrls(raw, new Set(['https://allowed.com/a']))
    expect(out.citations).toHaveLength(1)
    expect(out.citations[0]?.url).toBe('https://allowed.com/a')
  })
})

describe('hashPrompt', () => {
  it('shouldProduceStableHashForSameInputs', () => {
    expect(hashPrompt('a', 'b')).toBe(hashPrompt('a', 'b'))
  })
  it('shouldDifferWhenInputsDiffer', () => {
    expect(hashPrompt('a', 'b')).not.toBe(hashPrompt('a', 'c'))
  })
})

describe('adaptAnalystToMarketBrief', () => {
  const baseChain = {
    industry: 'tech',
    mechanism: 'AI demand surge',
    affectedTickers: ['NVDA'],
    direction: 'positive' as const,
    citations: [{ url: 'https://example.com/1', title: 'Example', quote: 'some quote' }],
  }

  it('allCitations empty → no throw, MarketBriefSchema still valid', () => {
    const analyst = {
      primaryImpact: 'Tech sector surges on AI demand',
      cascadeChains: [{ ...baseChain, citations: [] }],
      reasoning: 'AI capex increasing',
    }
    // Should not throw even with empty citations (downstream graceful injection handles it)
    const result = adaptAnalystToMarketBrief(analyst)
    // citations from all chains = [], MarketBriefSchema.citations.min(1) is NOT enforced here
    // (it is enforced post-injection in analyzeNewsItem); adaptAnalystToMarketBrief itself passes
    expect(result.headline).toBeTruthy()
    expect(result.citations).toHaveLength(0)
  })
})

describe('filterCitationsToAllowedUrls graceful injection', () => {
  it('graceful: empty analyst citations → synthetic placeholder injected by analyzeNewsItem', () => {
    const brief: RawAnalysis = {
      headline: 'h',
      summary: 's',
      relatedNews: [],
      affectedIndustries: [],
      relatedETFs: [],
      reasoningChain: ['a', 'b'],
      citations: [],
      disclaimer: '本分析僅供參考、非投資建議、實際投資請諮詢專業人士',
    }
    // After filter with empty allowed set, citations = []
    const filtered = filterCitationsToAllowedUrls(brief, new Set<string>())
    expect(filtered.citations).toHaveLength(0)
    // Simulate the graceful injection logic
    const withCitations = filtered.citations.length > 0
      ? filtered
      : { ...filtered, citations: [{ title: '資料不足', url: 'data:insufficient', quote: '此分析基於 Decomposer 推論、7 天內無相關新聞可佐證、citation 不可考' }] }
    // Should now pass MarketBriefSchema (synthetic placeholder satisfies min(1))
    const validated = MarketBriefSchema.safeParse(withCitations)
    expect(validated.success).toBe(true)
  })
})

describe('finalizeAnalystToMarketBrief', () => {
  const allowedUrls = new Set(['https://known/1'])
  const baseAnalyst = {
    primaryImpact: 'p',
    cascadeChains: [{
      industry: 'i',
      mechanism: 'm',
      affectedTickers: ['T'],
      direction: 'positive' as const,
      citations: [{ url: 'https://known/1', title: 't', quote: 'q' }],
    }],
    reasoning: 'r',
  }
  it('preserves citations in allowed url set', () => {
    const brief = finalizeAnalystToMarketBrief(baseAnalyst, [], allowedUrls)
    expect(brief.citations).toHaveLength(1)
    expect(brief.citations[0]?.url).toBe('https://known/1')
  })
  it('strips citations not in allowed urls and inserts placeholder when all stripped', () => {
    const baseChainItem = baseAnalyst.cascadeChains[0] as NonNullable<typeof baseAnalyst.cascadeChains[0]>
    const a = { ...baseAnalyst, cascadeChains: [{ ...baseChainItem, citations: [{ url: 'https://invented/666', title: 't', quote: 'q' }] }] }
    const brief = finalizeAnalystToMarketBrief(a, [], allowedUrls)
    expect(brief.citations).toHaveLength(1)
    expect(brief.citations[0]?.url).toBe('data:insufficient')
  })
  it('strips an L3 forbidden phrase instead of throwing (graceful degrade)', () => {
    const a = { ...baseAnalyst, primaryImpact: '建議買進台積電' }
    const brief = finalizeAnalystToMarketBrief(a, [], allowedUrls)
    // 不再 throw；違規詞被移除、brief 仍 schema-valid
    expect(MarketBriefSchema.safeParse(brief).success).toBe(true)
    expect(JSON.stringify(brief)).not.toContain('建議買')
  })

  it('substitutes a placeholder when a required field is fully stripped', () => {
    const a = { ...baseAnalyst, primaryImpact: '建議買進台積電' }
    const brief = finalizeAnalystToMarketBrief(a, [], allowedUrls)
    // headline 整句即違規 → 清空 → placeholder
    expect(brief.headline).toBe(COMPLIANCE_STRIPPED_PLACEHOLDER)
  })

  it('leaves a clean brief untouched through the safety gate', () => {
    const brief = finalizeAnalystToMarketBrief(baseAnalyst, [], allowedUrls)
    expect(brief.summary).toContain('p') // primaryImpact 'p' 保留
  })

  it('sanitizes 看空 in mechanism but does NOT touch url field', () => {
    const a = {
      ...baseAnalyst,
      cascadeChains: [{
        industry: '半導體',
        mechanism: '市場 看空 AI 晶片動能', // 應被改寫
        affectedTickers: ['NVDA'],
        direction: 'negative' as const,
        // 故意放一個 url 含「看空」字串、確保不被改寫
        citations: [{ url: 'https://example.com/?q=看空analysis', title: 't', quote: 'q' }],
      }],
    }
    const allowed = new Set(['https://example.com/?q=看空analysis'])
    const brief = finalizeAnalystToMarketBrief(a, [], allowed)
    // url 內的「看空」應保留（不在 prose 欄位）
    expect(brief.citations[0]?.url).toBe('https://example.com/?q=看空analysis')
    // affectedIndustries.reasoning 來自 mechanism、應已 rewrite
    expect(brief.affectedIndustries[0]?.reasoning).not.toContain('看空')
    expect(brief.affectedIndustries[0]?.reasoning).toContain('估值承壓')
  })

  it('sanitizes soft-recommendation phrase 值得關注 under canonical map (no throw)', () => {
    const a = {
      ...baseAnalyst,
      cascadeChains: [{
        industry: '半導體',
        mechanism: 'AI 晶片動能 值得關注', // 軟推薦詞、canonical map 應改寫
        affectedTickers: ['NVDA'],
        direction: 'positive' as const,
        citations: [],
      }],
    }
    const brief = finalizeAnalystToMarketBrief(a, [], allowedUrls)
    expect(brief.affectedIndustries[0]?.reasoning).not.toContain('值得關注')
    expect(brief.affectedIndustries[0]?.reasoning).toContain('後續可觀察')
  })

  it('truncates overlong summary at sentence boundary without 「…」', () => {
    // 讓 primaryImpact 全由 看多 組成 → 超 300 chars → adaptAnalystToMarketBrief 預截
    // → sanitize 把每個「看多」改寫為「動能延續」(2→4 字、+2)→ summary 再次超 300
    // → 當前 clampString 補「…」→ not.toContain('…') 紅；truncateAtSentence 不補「…」→ 綠
    const a = {
      ...baseAnalyst,
      primaryImpact: '看多'.repeat(155),
      reasoning: 'r',
    }
    const brief = finalizeAnalystToMarketBrief(a, [], allowedUrls)
    expect(brief.summary.length).toBeLessThanOrEqual(300)
    expect(brief.summary).not.toContain('…')
  })

  it('clamps headline / summary / reasoningChain to schema max even when sanitize expands rewrite', () => {
    // primaryImpact 有 78 字 + 「看多」(2) = 80 字、slice(0, 80) 保留 80 字（含「看多」）。
    // sanitize 把「看多」改寫為「動能延續」(4 字)、若不 clamp、headline = 82 字、超出 max(80)。
    const longPrimary = `${'產'.repeat(78)}看多`
    expect(longPrimary).toHaveLength(80)
    const a = {
      ...baseAnalyst,
      primaryImpact: longPrimary,
      reasoning: `${'看多 '.repeat(60)}尾巴`, // 強制 reasoningChain 段超 150 字後被改寫
    }
    const brief = finalizeAnalystToMarketBrief(a, [], allowedUrls)
    expect(brief.headline.length).toBeLessThanOrEqual(80)
    expect(brief.summary.length).toBeLessThanOrEqual(300)
    for (const step of brief.reasoningChain)
      expect(step.length).toBeLessThanOrEqual(150)
  })

  it('stays shippable when an unmapped forbidden phrase fills a min(1) field', () => {
    // 保證獲利 不在 rewrite map → 原樣到 gate；落在 citations.quote（min 1）整句即違規
    // → strip 清空 → 必須補 placeholder、不可 throw
    const baseChainItem = baseAnalyst.cascadeChains[0] as NonNullable<typeof baseAnalyst.cascadeChains[0]>
    const a = { ...baseAnalyst, cascadeChains: [{ ...baseChainItem, citations: [{ url: 'https://known/1', title: 't', quote: '保證獲利' }] }] }
    const brief = finalizeAnalystToMarketBrief(a, [], allowedUrls)
    expect(MarketBriefSchema.safeParse(brief).success).toBe(true)
    expect(JSON.stringify(brief)).not.toContain('保證獲利')
  })

  it('removes a cross-sentence ticker+direction proximity violation', () => {
    const a = { ...baseAnalyst, primaryImpact: '焦點落在2330。加碼壓力浮現' }
    const brief = finalizeAnalystToMarketBrief(a, [], allowedUrls)
    expect(MarketBriefSchema.safeParse(brief).success).toBe(true)
    expect(JSON.stringify(brief)).not.toContain('加碼')
  })

  it('sanitize is idempotent (no infinite rewrite loop)', () => {
    const baseChainItem = baseAnalyst.cascadeChains[0] as NonNullable<typeof baseAnalyst.cascadeChains[0]>
    const a = {
      ...baseAnalyst,
      cascadeChains: [{
        ...baseChainItem,
        mechanism: '看空 看多 偏空 佈局 加碼時機',
      }],
    }
    const brief = finalizeAnalystToMarketBrief(a, [], allowedUrls)
    const text = JSON.stringify(brief)
    expect(text).not.toContain('看空')
    expect(text).not.toContain('看多')
    expect(text).not.toContain('偏空')
    expect(text).not.toContain('佈局')
    expect(text).not.toContain('加碼時機')
  })
})

describe('finalizeBriefSafety cross-field compliance', () => {
  it('treats a ticker and a direction verb in separate prose fields as non-violation', () => {
    // headline 含 ticker 2330、summary 含 bare 加碼、各自欄位皆 clean（非 reader-adjacent）→ 內容不動
    const brief: MarketBrief = {
      headline: '台股焦點 2330',
      summary: '加碼買盤的觀察',
      relatedNews: [],
      affectedIndustries: [],
      relatedETFs: [],
      reasoningChain: ['步驟一', '步驟二'],
      citations: [{ title: 't', url: 'https://known/1', quote: 'q' }],
      disclaimer: MarketBriefDisclaimer,
    }
    const out = finalizeBriefSafety(brief)
    expect(out.headline).toBe('台股焦點 2330')
    expect(out.summary).toBe('加碼買盤的觀察')
  })
})

// CascadeChainSchema 的 citation url 只要 min(1)、MarketBriefCitationSchema 要 .url()。
// 兩者不對稱、而 adaptAnalystToMarketBrief 是把 chain citations 直接 flatMap 過去的，
// 所以一個沒有 scheme 的字串（例如新聞內部 id）會一路走到 MarketBriefSchema.parse 才炸。
// 炸掉的代價不是少一條引用：db-related／cache-hit 會被 runAnalyze 的 try/catch 接住、
// 整套 decomposer + tier1 + tier2 重跑一次（帳單翻倍、使用者拿到完全不同的分析），
// 其餘 mode 則直接 job 失敗。
describe('finalizeBriefSafety citation url gate', () => {
  const clean: MarketBrief = {
    headline: 'h',
    summary: 's',
    relatedNews: [],
    affectedIndustries: [],
    relatedETFs: [],
    reasoningChain: ['步驟一', '步驟二'],
    citations: [{ title: 't', url: 'https://real/1', quote: 'q' }],
    disclaimer: MarketBriefDisclaimer,
  }

  it('drops an unparsable citation url instead of throwing', () => {
    const out = finalizeBriefSafety({
      ...clean,
      citations: [
        { title: 't', url: '6578928', quote: 'q' },
        { title: 't2', url: 'https://real/1', quote: 'q' },
      ],
    })
    expect(out.citations.map(c => c.url)).toEqual(['https://real/1'])
  })

  it('keeps every url the schema itself accepts, not just http(s)', () => {
    // 判準必須跟 MarketBriefCitationSchema 是同一份，不能收緊成「只留 http(s)」：
    // data:insufficient 是 graceful sentinel（收緊就會把 placeholder 自己殺掉），
    // analyses://<id> 是 routing.ts 的 toRetrievedArticleShape 會餵進候選池的內部
    // 引用——兩者都過得了 .url()，都不是這裡要處理的對象。
    const urls = [INSUFFICIENT_CITATION_URL, 'analyses://12', 'https://real/1']
    const out = finalizeBriefSafety({
      ...clean,
      citations: urls.map(u => ({ title: 't', url: u, quote: 'q' })),
    })
    expect(out.citations.map(c => c.url)).toEqual(urls)
  })

  it('falls back to the placeholder when every citation url is unparsable', () => {
    // 過濾掉之後可能是空陣列、而 MarketBriefSchema.citations 是 min(1)——
    // 少了這一步，只是把 throw 從 url 換成 too_small、什麼也沒修好。
    const out = finalizeBriefSafety({
      ...clean,
      citations: [
        { title: 't', url: '6578928', quote: 'q' },
        { title: 't2', url: 'spaceX_ipo_inflation_shock', quote: 'q' },
      ],
    })
    expect(out.citations).toHaveLength(1)
    expect(out.citations[0]?.url).toBe(INSUFFICIENT_CITATION_URL)
  })

  // 丟掉之後要留得下痕跡。這裡把「爛 url」從『炸掉 → fallback → background_jobs
  // 記下 fallbackFrom』換成『安靜丟掉』，如果只留一行 console.warn，就等於用一個
  // 靜默失敗換掉另一個——而這整份 spec 就是在治靜默失敗。
  it('records the drop count in the optional stats object', () => {
    const stats = { droppedCitationUrls: 0 }
    finalizeBriefSafety({
      ...clean,
      citations: [
        { title: 't', url: '6578928', quote: 'q' },
        { title: 't2', url: 'https://real/1', quote: 'q' },
      ],
    }, stats)
    expect(stats.droppedCitationUrls).toBe(1)
  })

  it('leaves the stats object at zero when nothing is dropped', () => {
    const stats = { droppedCitationUrls: 0 }
    finalizeBriefSafety(clean, stats)
    expect(stats.droppedCitationUrls).toBe(0)
  })

  it('still throws when the parse failure is not citation-url shaped', () => {
    // 反向對照：這裡只拆掉「爛 citation url」這一種 throw。db-related／cache-hit 的
    // fallback 網子還在，別把它讀成「finalizeBriefSafety 從此不會 throw」。
    // relatedNews.url 同樣是 .url()、而且沒有任何一層在過濾它。
    expect(() => finalizeBriefSafety({
      ...clean,
      relatedNews: [{ title: 'n', url: '6578928', relationType: 'cause', reasoning: 'r' }],
    })).toThrow()
  })
})
