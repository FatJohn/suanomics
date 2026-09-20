import type { AnalystOutput } from '../../agents/types.js'
import * as repoMod from '@suanomics/db/repos/news-repo'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as analystMod from '../../agents/analyst.js'
import * as orchestratorMod from '../../agents/orchestrator.js'
import * as retrieverMod from '../../agents/retriever.js'
import * as routingMod from '../../brief/routing.js'
import { runAnalyze } from './analyze-worker.js'

vi.mock('../../brief/routing.js')
vi.mock('../../agents/orchestrator.js')
vi.mock('../../agents/analyst.js')
vi.mock('../../agents/retriever.js')
vi.mock('@suanomics/db/repos/news-repo')

const sampleBrief = {
  headline: 'h',
  summary: 's',
  relatedNews: [],
  affectedIndustries: [],
  relatedETFs: [],
  reasoningChain: ['r1', 'r2'],
  citations: [{ url: 'https://x/1', title: 't', quote: 'q' }],
  disclaimer: '本分析僅供參考、非投資建議、實際投資請諮詢專業人士',
}

const sampleInput = { title: 'T', content: 'C', url: 'https://x.com/a' }

function makeCtx() {
  return {
    updateProgress: vi.fn().mockResolvedValue(undefined),
    markMetadata: vi.fn().mockResolvedValue(undefined),
  }
}

describe('runAnalyze', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('cache-hit mode: skip everything, save with cached entities + return cached payload', async () => {
    vi.mocked(routingMod.decideRouting).mockResolvedValue({
      mode: 'cache-hit',
      cached: { id: 1, payload: sampleBrief as never, entities: ['fed'], expiresAt: null },
    })
    vi.mocked(repoMod.saveAnalysis).mockResolvedValue(99)
    const ctx = makeCtx()
    const r = await runAnalyze(sampleInput, ctx)
    expect(r.routingMode).toBe('cache-hit')
    expect(r.payload).toEqual(sampleBrief)
    expect(orchestratorMod.runAnalystOnly).not.toHaveBeenCalled()
    expect(orchestratorMod.runSingleNews).not.toHaveBeenCalled()
    expect(analystMod.callAnalystTier1).not.toHaveBeenCalled()
    expect(ctx.markMetadata).toHaveBeenCalledWith({ routingMode: 'cache-hit' })
    expect(repoMod.saveAnalysis).toHaveBeenCalledOnce()
    expect(ctx.updateProgress).toHaveBeenCalledWith(25, 'routing')
    expect(ctx.updateProgress).toHaveBeenCalledWith(100, 'saving')
  })

  it('db-related mode: skip decomposer + retriever, run analyst once', async () => {
    vi.mocked(routingMod.decideRouting).mockResolvedValue({
      mode: 'db-related',
      inputCanonical: ['fed', 'rate-cut'],
      cachedNeighbors: [
        {
          id: 1,
          payload: {
            ...sampleBrief,
            affectedIndustries: [
              { name: '半導體', direction: 'positive', confidence: 'medium', reasoning: 'm' },
            ],
          } as never,
          entities: ['fed'],
          expiresAt: null,
        },
      ],
    })
    vi.mocked(orchestratorMod.runAnalystOnly).mockResolvedValue({
      primaryImpact: 'p',
      cascadeChains: [{
        industry: 'i',
        mechanism: 'm',
        affectedTickers: [],
        direction: 'positive',
        citations: [],
      }],
      reasoning: 'r',
    })
    vi.mocked(repoMod.saveAnalysis).mockResolvedValue(100)
    const r = await runAnalyze(sampleInput, makeCtx())
    expect(r.routingMode).toBe('db-related')
    expect(orchestratorMod.runAnalystOnly).toHaveBeenCalledOnce()
    expect(orchestratorMod.runSingleNews).not.toHaveBeenCalled()
  })

  // cache-hit 分支直接回 cached payload、之後又原樣重存一次，完全不過閘。
  // 後果不是假想——修好之前由 db-related 寫進去的 row，在 24h cache 窗內仍會
  // 被再供一次、再存一次，帶著沒清過的禁用詞。
  it('cache-hit mode: cached payload 也要過合規閘', async () => {
    vi.mocked(routingMod.decideRouting).mockResolvedValue({
      mode: 'cache-hit',
      cached: {
        id: 7,
        payload: { ...sampleBrief, headline: '這檔建議買進、穩賺不賠' } as never,
        entities: ['fed'],
        expiresAt: null,
      },
    })
    vi.mocked(repoMod.saveAnalysis).mockResolvedValue(130)
    const r = await runAnalyze(sampleInput, makeCtx())
    expect(r.routingMode).toBe('cache-hit')
    const blob = JSON.stringify(r.payload)
    expect(blob).not.toContain('建議買')
    expect(blob).not.toContain('穩賺不賠')
  })

  // cached payload 是舊格式（之前寫進去的沒過 schema）時，過閘會 throw。
  // 那時候寧可重跑也不要讓整個 job 失敗——cache-hit 原本不在 fallback 的涵蓋範圍內。
  // 這裡用 reasoningChain 短於 min(2) 當「舊格式」的代表：爛 citation url
  // 已經不會 throw（改成在閘裡丟掉），拿它當素材會讓這條測試靜默失去意義。
  it('cache-hit mode: cached payload 過不了 schema 時 fallback 到 full-pipeline', async () => {
    vi.mocked(routingMod.decideRouting).mockResolvedValue({
      mode: 'cache-hit',
      cached: {
        id: 8,
        payload: { ...sampleBrief, reasoningChain: ['只有一步'] } as never,
        entities: ['fed'],
        expiresAt: null,
      },
    })
    vi.mocked(orchestratorMod.runSingleNews).mockResolvedValue({
      analyst: {
        primaryImpact: 'fallback',
        cascadeChains: [{ industry: 'i', mechanism: 'm', affectedTickers: [], direction: 'positive', citations: [] }],
        reasoning: 'r',
      },
      retrievedUrls: [],
    })
    vi.mocked(repoMod.saveAnalysis).mockResolvedValue(131)
    const r = await runAnalyze(sampleInput, makeCtx())
    expect(r.routingMode).toBe('full-pipeline')
    expect(orchestratorMod.runSingleNews).toHaveBeenCalledOnce()
  })

  // 爛 citation url 不再算「過不了 schema」——它在閘裡被丟掉。這條釘的是
  // 「不要為了一條爛連結重跑整套 LLM」：重跑的代價是使用者拿到完全不同的分析、
  // 帳單翻倍，而線上只留一行 console.warn。
  it('cache-hit mode: 爛 citation url 只丟那條、不觸發 full-pipeline 重跑', async () => {
    vi.mocked(routingMod.decideRouting).mockResolvedValue({
      mode: 'cache-hit',
      cached: {
        id: 9,
        payload: { ...sampleBrief, citations: [{ url: '6578928', title: 't', quote: 'q' }] } as never,
        entities: ['fed'],
        expiresAt: null,
      },
    })
    vi.mocked(repoMod.saveAnalysis).mockResolvedValue(132)
    const r = await runAnalyze(sampleInput, makeCtx())
    expect(r.routingMode).toBe('cache-hit')
    expect(orchestratorMod.runSingleNews).not.toHaveBeenCalled()
    expect(r.payload.citations.map(c => c.url)).toEqual(['data:insufficient'])
  })

  // db-related 以前不過 finalizeBriefSafety，投信投顧法禁用詞清洗、
  // MarketBriefSchema.parse、字串 clamp 三層一起少掉，而 saveAnalysis 下游沒有
  // 第二道閘。finalizeAnalystToMarketBrief 的檔頭註解本來就寫著它是「抽出供
  // worker（db-related mode）與 route 共用」，所以這是漏接不是設計。
  function mockDbRelated(analyst: AnalystOutput): void {
    vi.mocked(routingMod.decideRouting).mockResolvedValue({
      mode: 'db-related',
      inputCanonical: ['fed', 'rate-cut'],
      cachedNeighbors: [{
        id: 1,
        payload: { ...sampleBrief, affectedIndustries: [{ name: '半導體', direction: 'positive', confidence: 'medium', reasoning: 'm' }] } as never,
        entities: ['fed'],
        expiresAt: null,
      }],
    })
    vi.mocked(orchestratorMod.runAnalystOnly).mockResolvedValue(analyst)
    vi.mocked(repoMod.saveAnalysis).mockResolvedValue(120)
  }

  it('db-related mode: 禁用詞要被清掉（投信投顧法硬 gate）', async () => {
    mockDbRelated({
      primaryImpact: '這檔建議買進、穩賺不賠',
      cascadeChains: [{
        industry: 'i',
        mechanism: '後續一定會漲、保證獲利',
        // affectedTickers 也進 sanitize 的掃描範圍了，所以這裡放一個帶禁用詞的值，
        // 讓下面那條「掃整包 payload」的斷言真的涵蓋這個欄位（在那之前它是唯一的漏網欄位）。
        affectedTickers: ['2330 建議買進'],
        direction: 'positive',
        citations: [{ url: 'https://real-news.example/a', title: 't', quote: '穩賺不賠' }],
      }],
      reasoning: 'r',
    })
    const r = await runAnalyze(sampleInput, makeCtx())
    // 斷言整包 payload 而不是只看 brief.citations——cascadeChains 是 pass-through，
    // 只看前者會漏掉一半的表面積
    const blob = JSON.stringify(r.payload)
    for (const banned of ['建議買', '穩賺不賠', '一定會漲', '保證獲利'])
      expect(blob, `payload 仍含禁用詞 ${banned}`).not.toContain(banned)
  })

  // affectedTickers 在 analyzer 有**三份**欄位清單要同時涵蓋：偵測
  // （briefProseFields）、改寫（sanitizeAnalystForbiddenPhrases）、strip
  // （stripBriefViolatingSentences）。三份對字面禁用詞的效果互相蓋得住，所以要用
  // 兩個不同性質的違規才驗得出各自的必要性——實測值見下：
  //
  //   '2330 加碼' → checkCompliance = ticker-direction、rewriteText 動不了它
  //                 ⇒ 只有「偵測 → strip」這條路清得掉
  //   '2330 偏多' → checkCompliance = forbidden、rewriteText 改寫成「2330 動能偏強」
  //                 ⇒ 改寫那份負責把內容留下來，而不是整條刪掉
  it('db-related mode: 只有 affectedTickers 違規時也要清掉（ticker+方向詞，改寫表救不了）', async () => {
    mockDbRelated({
      primaryImpact: 'p',
      cascadeChains: [{
        industry: 'i',
        mechanism: 'm',
        affectedTickers: ['2330 加碼'],
        direction: 'positive',
        citations: [{ url: 'https://real-news.example/a', title: 't', quote: 'q' }],
      }],
      reasoning: 'r',
    })
    const r = await runAnalyze(sampleInput, makeCtx())
    expect(JSON.stringify(r.payload)).not.toContain('加碼')
  })

  it('db-related mode: 字面禁用詞的 ticker 走改寫、內容留下來而不是整條刪掉', async () => {
    mockDbRelated({
      primaryImpact: 'p',
      cascadeChains: [{
        industry: 'i',
        mechanism: 'm',
        affectedTickers: ['2330 偏多'],
        direction: 'positive',
        citations: [{ url: 'https://real-news.example/a', title: 't', quote: 'q' }],
      }],
      reasoning: 'r',
    })
    const r = await runAnalyze(sampleInput, makeCtx())
    const tickers = r.payload.cascadeChains?.[0]?.affectedTickers ?? []
    expect(tickers).toEqual(['2330 動能偏強'])
  })

  // ★ 回歸守衛：2026-08-21 修這個問題時差點在這裡多加一層 citation allowlist。
  // 那會殺掉 tier 2 的合法引用——db-related 的 tier 1 吃 retrieved=[]，所以
  // 有 citation 的話一律來自 tier 2，而 tier 2 的 citation 已經綁在它自己
  // retrieveArticles 的結果上（analyst-tier2.ts:68）。多擋一次的線上表現是
  // 「每則 db-related 分析都變成資料不足」，而且不會有任何測試轉紅。
  it('db-related mode: tier 2 帶進來的合法 citation 不可以被吃掉', async () => {
    mockDbRelated({
      primaryImpact: 'p',
      cascadeChains: [{
        industry: 'i',
        mechanism: 'm',
        affectedTickers: [],
        direction: 'positive',
        citations: [{ url: 'https://real-news.example/tier2', title: 't', quote: 'q' }],
      }],
      reasoning: 'r',
    })
    const r = await runAnalyze(sampleInput, makeCtx())
    expect(r.payload.citations.map(c => c.url)).toContain('https://real-news.example/tier2')
    expect(r.payload.citations.map(c => c.url)).not.toContain('data:insufficient')
  })

  // CascadeChainSchema 的 citation url 只要 z.string().min(1)，而
  // MarketBriefCitationSchema 要 z.string().url()——兩者不對稱，所以一個能過 tier 2
  // 白名單的爛 URL 以前會在 MarketBriefSchema.parse 才炸，被 try/catch 接住、改派
  // full-pipeline：整套 decomposer + tier1 + tier2 重跑一次，使用者拿到完全不同的
  // 分析、帳單翻倍，線上只留一行 console.warn。
  //
  // 現在它在安全閘裡被丟掉。這條釘的是「降級成少一條引用」而不是「重跑」——
  // db-related 的 fallback 網子本身另有測試（runAnalystOnly throw 那條）守著。
  it('db-related mode: 爛 citation url 只丟那條、不觸發 full-pipeline 重跑', async () => {
    mockDbRelated({
      primaryImpact: 'p',
      cascadeChains: [{
        industry: 'i',
        mechanism: 'm',
        affectedTickers: [],
        direction: 'positive',
        // 過得了 CascadeChainSchema（min(1)），過不了 MarketBriefCitationSchema（url()）
        citations: [{ url: '6578928', title: 't', quote: 'q' }],
      }],
      reasoning: 'r',
    })
    const audit = makeCtx()
    const r = await runAnalyze(sampleInput, audit)
    expect(r.routingMode).toBe('db-related')
    expect(orchestratorMod.runSingleNews).not.toHaveBeenCalled()
    expect(r.payload.citations.map(c => c.url)).toEqual(['data:insufficient'])
    // 丟掉那條要留痕：以前這個 case 會 fallback、而 fallback 會寫進
    // background_jobs.metadata；改成安靜丟掉之後，若不補這一筆就等於用一個靜默
    // 失敗換掉另一個。上游若開始系統性吐內部 id 當 citation，這是唯一查得到的地方。
    expect(audit.markMetadata).toHaveBeenCalledWith({ droppedCitationUrls: 1 })
  })

  it('gap-scrape mode: DB 候選 + analyst（跳過 decomposer）', async () => {
    vi.mocked(routingMod.decideRouting).mockResolvedValue({
      mode: 'gap-scrape',
      inputCanonical: ['fed'],
      existingDbArticles: [],
    })
    vi.mocked(retrieverMod.retrieveArticles).mockResolvedValue([
      { id: 'ext-9', url: 'https://ext/9', title: 't', contentSummary: 's', entities: [], topicTags: [], fetchedAt: '2026-04-26' },
    ])
    vi.mocked(analystMod.callAnalystTier1).mockResolvedValue({
      primaryImpact: 'p',
      cascadeChains: [{
        industry: 'i',
        mechanism: 'm',
        affectedTickers: [],
        direction: 'positive',
        citations: [{ url: 'https://ext/9', title: 't', quote: 'q' }],
      }],
      reasoning: 'r',
    })
    vi.mocked(repoMod.saveAnalysis).mockResolvedValue(101)
    const r = await runAnalyze(sampleInput, makeCtx())
    expect(r.routingMode).toBe('gap-scrape')
    expect(analystMod.callAnalystTier1).toHaveBeenCalledOnce()
    expect(orchestratorMod.runSingleNews).not.toHaveBeenCalled()
  })

  it('gap-scrape mode: also calls retriever against external_articles as fallback', async () => {
    // existingDbArticles 空時 gap-scrape 不該讓 analyst 拿空 retriever、
    // 應 fallback 到 external_articles（2026-08-21 移除 firecrawl 後，這是唯一素材來源）
    vi.mocked(routingMod.decideRouting).mockResolvedValue({
      mode: 'gap-scrape',
      inputCanonical: ['fed', 'rate-cut'],
      existingDbArticles: [],
    })
    vi.mocked(retrieverMod.retrieveArticles).mockResolvedValue([
      { id: 'ext-1', url: 'https://ext/1', title: 'real article', contentSummary: 's', entities: [], topicTags: [], fetchedAt: '2026-04-26' },
    ])
    vi.mocked(analystMod.callAnalystTier1).mockResolvedValue({
      primaryImpact: 'p',
      cascadeChains: [{
        industry: 'i',
        mechanism: 'm',
        affectedTickers: [],
        direction: 'positive',
        citations: [{ url: 'https://ext/1', title: 'real article', quote: 'q' }],
      }],
      reasoning: 'r',
    })
    vi.mocked(repoMod.saveAnalysis).mockResolvedValue(110)
    const r = await runAnalyze({ ...sampleInput, reportDate: '2026-05-03' }, makeCtx())
    expect(r.routingMode).toBe('gap-scrape')
    expect(retrieverMod.retrieveArticles).toHaveBeenCalledOnce()
    // ★ 檢索窗的上界錨在報告日，這裡釘的是傳下去的**值**不是「有傳」。
    //   少了這行，把 analyze-worker 的 `reportDate: briefDate` 改成今天不會有測試紅，
    //   而補產舊分析會靜默用今天的窗（表現與正確時一模一樣）。
    expect(vi.mocked(retrieverMod.retrieveArticles).mock.calls[0]?.[0]?.reportDate).toBe('2026-05-03')
    // analyst 應該收到 retriever 找到的 external article、不是 placeholder
    // eslint-disable-next-line ts/no-non-null-assertion -- callAnalystTier1 was called (asserted above), calls[0] is defined
    const analystCallArgs = vi.mocked(analystMod.callAnalystTier1).mock.calls[0]![0]
    expect(analystCallArgs.retrieved).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ url: 'https://ext/1' }),
      ]),
    )
  })

  it('full-pipeline mode: runSingleNews', async () => {
    vi.mocked(routingMod.decideRouting).mockResolvedValue({ mode: 'full-pipeline' })
    vi.mocked(orchestratorMod.runSingleNews).mockResolvedValue({
      analyst: {
        primaryImpact: 'p',
        cascadeChains: [{
          industry: 'i',
          mechanism: 'm',
          affectedTickers: [],
          direction: 'positive',
          citations: [{ url: 'https://x.com/a', title: 't', quote: 'q' }],
        }],
        reasoning: 'r',
      },
      retrievedUrls: [],
    })
    vi.mocked(repoMod.saveAnalysis).mockResolvedValue(102)
    const r = await runAnalyze(sampleInput, makeCtx())
    expect(r.routingMode).toBe('full-pipeline')
    expect(orchestratorMod.runSingleNews).toHaveBeenCalledOnce()
  })

  it('db-related fallback to full-pipeline when runAnalystOnly throws', async () => {
    vi.mocked(routingMod.decideRouting).mockResolvedValue({
      mode: 'db-related',
      inputCanonical: ['fed', 'rate-cut'],
      cachedNeighbors: [{ id: 1, payload: sampleBrief as never, entities: ['fed'], expiresAt: null }],
    })
    vi.mocked(orchestratorMod.runAnalystOnly).mockRejectedValue(new Error('analyst boom'))
    vi.mocked(orchestratorMod.runSingleNews).mockResolvedValue({
      analyst: {
        primaryImpact: 'p',
        cascadeChains: [{
          industry: 'i',
          mechanism: 'm',
          affectedTickers: [],
          direction: 'positive',
          citations: [{ url: 'https://x.com/a', title: 't', quote: 'q' }],
        }],
        reasoning: 'r',
      },
      retrievedUrls: [],
    })
    vi.mocked(repoMod.saveAnalysis).mockResolvedValue(103)
    const r = await runAnalyze(sampleInput, makeCtx())
    expect(r.routingMode).toBe('full-pipeline')
    expect(orchestratorMod.runSingleNews).toHaveBeenCalledOnce()
  })

  it('saveAnalysis links to newsItemId when payload includes it', async () => {
    vi.mocked(routingMod.decideRouting).mockResolvedValue({ mode: 'full-pipeline' })
    vi.mocked(orchestratorMod.runSingleNews).mockResolvedValue({
      analyst: {
        primaryImpact: 'p',
        cascadeChains: [{
          industry: 'i',
          mechanism: 'm',
          affectedTickers: ['T'],
          direction: 'positive',
          citations: [{ url: 'https://x.com/a', title: 't', quote: 'q' }],
        }],
        reasoning: 'r',
      },
      retrievedUrls: [],
    })
    vi.mocked(repoMod.saveAnalysis).mockResolvedValue(105)
    await runAnalyze({ ...sampleInput, newsItemId: 42 }, makeCtx())
    // eslint-disable-next-line ts/no-non-null-assertion -- saveAnalysis was called (asserted above), calls[0] is defined
    const call = vi.mocked(repoMod.saveAnalysis).mock.calls[0]![0]
    expect(call.newsItemId).toBe(42)
  })

  it('saveAnalysis newsItemId stays null when payload does not include it', async () => {
    vi.mocked(routingMod.decideRouting).mockResolvedValue({ mode: 'full-pipeline' })
    vi.mocked(orchestratorMod.runSingleNews).mockResolvedValue({
      analyst: {
        primaryImpact: 'p',
        cascadeChains: [{
          industry: 'i',
          mechanism: 'm',
          affectedTickers: ['T'],
          direction: 'positive',
          citations: [{ url: 'https://x.com/a', title: 't', quote: 'q' }],
        }],
        reasoning: 'r',
      },
      retrievedUrls: [],
    })
    vi.mocked(repoMod.saveAnalysis).mockResolvedValue(106)
    await runAnalyze(sampleInput, makeCtx())
    // eslint-disable-next-line ts/no-non-null-assertion -- saveAnalysis was called (asserted above), calls[0] is defined
    const call = vi.mocked(repoMod.saveAnalysis).mock.calls[0]![0]
    expect(call.newsItemId).toBeNull()
  })

  it('saveAnalysis always called with canonical entities + 24h expiry', async () => {
    vi.mocked(routingMod.decideRouting).mockResolvedValue({ mode: 'full-pipeline' })
    vi.mocked(orchestratorMod.runSingleNews).mockResolvedValue({
      analyst: {
        primaryImpact: 'p',
        cascadeChains: [{
          industry: '半導體',
          mechanism: 'm',
          affectedTickers: ['TSMC'],
          direction: 'positive',
          citations: [{ url: 'https://x.com/a', title: 't', quote: 'q' }],
        }],
        reasoning: 'r',
      },
      retrievedUrls: [],
    })
    vi.mocked(repoMod.saveAnalysis).mockResolvedValue(104)
    await runAnalyze(sampleInput, makeCtx())
    // eslint-disable-next-line ts/no-non-null-assertion -- saveAnalysis was called (asserted above), calls[0] is defined
    const call = vi.mocked(repoMod.saveAnalysis).mock.calls[0]![0]
    expect(call.entities.length).toBeGreaterThan(0)
    expect(call.entities.every(e => typeof e === 'string')).toBe(true)
    const expiry = call.expiresAt.getTime() - Date.now()
    expect(expiry).toBeGreaterThan(23 * 3600 * 1000)
    expect(expiry).toBeLessThan(25 * 3600 * 1000)
  })
})
