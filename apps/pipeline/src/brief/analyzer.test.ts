import type { MarketBrief } from '@suanomics/shared'
import { MarketBriefDisclaimer } from '@suanomics/shared'
import { describe, expect, it } from 'vitest'
import { finalizeBriefSafety, INSUFFICIENT_CITATION_URL } from './analyzer.js'

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
