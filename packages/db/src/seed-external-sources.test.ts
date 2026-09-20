import { describe, expect, it } from 'vitest'
import { ACCEPTED_ZERO_ENRICHMENT_SLUGS, ACCEPTED_ZERO_OUTPUT_SLUGS, AGGREGATOR_PROXY_SLUGS, EXTERNAL_SOURCES_SEED, ExternalSourceSeedSchema, isAggregatorProxySeed } from './seed-external-sources.js'

describe('eXTERNAL_SOURCES_SEED', () => {
  it('每筆符合 zod schema', () => {
    for (const src of EXTERNAL_SOURCES_SEED)
      expect(() => ExternalSourceSeedSchema.parse(src)).not.toThrow()
  })

  it('恰有 25 個 Tier 1 + 5 個 Tier 2（含 15 個跨域 source）', () => {
    const t1 = EXTERNAL_SOURCES_SEED.filter(s => s.tier === 1)
    const t2 = EXTERNAL_SOURCES_SEED.filter(s => s.tier === 2)
    expect(t1).toHaveLength(25)
    expect(t2).toHaveLength(5)
  })

  it('slug 唯一', () => {
    const slugs = EXTERNAL_SOURCES_SEED.map(s => s.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it('tier 1 全為 rss kind', () => {
    const t1 = EXTERNAL_SOURCES_SEED.filter(s => s.tier === 1)
    for (const s of t1) expect(s.kind).toBe('rss')
  })

  it('tier 2 只能是 html-selector 或 official-feed kind', () => {
    const t2 = EXTERNAL_SOURCES_SEED.filter(s => s.tier === 2)
    for (const s of t2) expect(['html-selector', 'official-feed']).toContain(s.kind)
  })

  // 這幾條釘的是「已查證可用的取得路徑」，
  // 不是風格偏好——每一條都對應一個實測過的失效（見 PR 描述的實測表）。改動前請重跑實測。
  describe('換 feed（2026-08-21 以 production fetchRssSource 實測）', () => {
    const bySlug = new Map(EXTERNAL_SOURCES_SEED.map(s => [s.slug, s]))
    const feedUrlOf = (slug: string): string => {
      const s = bySlug.get(slug)
      if (!s || !('feedUrl' in s.config))
        throw new Error(`seed ${slug} 不存在或無 feedUrl`)
      return s.config.feedUrl
    }

    // 問題 ①：代理來源的 citation 是 news.google.com 不透明轉址，讀者點不到原文。
    it.each(['bloomberg-markets', 'whitehouse-statements'])('%s 已改直連官方 feed、不得再走 Google News 代理', (slug) => {
      const host = new URL(feedUrlOf(slug)).host
      expect(host).not.toBe('news.google.com')
    })

    it('bloomberg-markets 指向 bloomberg.com 官方 feed', () => {
      expect(new URL(feedUrlOf('bloomberg-markets')).host).toBe('www.bloomberg.com')
    })

    it('whitehouse-statements 指向 whitehouse.gov 官方 feed', () => {
      expect(new URL(feedUrlOf('whitehouse-statements')).host).toBe('www.whitehouse.gov')
    })

    // 問題 ⑤：五個官方來源零產出。這兩個有官方 RSS 卻設成過期的 html-selector。
    it.each(['fomc-statements', 'cbc-press'])('%s 改用官方 RSS、kind 為 official-feed', (slug) => {
      const s = bySlug.get(slug)
      expect(s?.kind).toBe('official-feed')
      expect(s?.config).toHaveProperty('feedUrl')
      expect(s?.config).toHaveProperty('format')
    })

    // 問題 ⑤ 後半：三個台灣財經 RSS 各自獨立壞掉（棄用路徑／失效子分類代碼／空殼產生器）。
    // 釘住已驗證的替代路徑，避免改回原本那三個回 200 卻沒有內容的網址。
    it('liberty-finance 走 news. 子網域（ec. 的 RSS 路徑已棄用、回 HTML 錯誤頁）', () => {
      expect(feedUrlOf('liberty-finance')).toBe('https://news.ltn.com.tw/rss/business.xml')
    })

    it('udn-money 不帶已失效的子分類代碼 7240/7241（回合法 XML 但 items=0）', () => {
      const url = feedUrlOf('udn-money')
      expect(url).toBe('https://money.udn.com/rssfeed/news/1001?ch=money')
      expect(url).not.toContain('7240')
    })

    it('udn-main 走 /news/rssfeed/（舊 /rssfeed/news/2/0/ 回空殼、pubDate 1970）', () => {
      expect(feedUrlOf('udn-main')).toBe('https://udn.com/news/rssfeed/')
    })
  })

  describe('停用的來源', () => {
    it('udn-money / udn-main 標成 enabled: false', () => {
      for (const slug of ['udn-money', 'udn-main']) {
        const src = EXTERNAL_SOURCES_SEED.find(s => s.slug === slug)
        expect(src, slug).toBeDefined()
        expect(src?.enabled, slug).toBe(false)
      }
    })

    it('其餘來源不帶 enabled（＝預設啟用），停用是明示的例外', () => {
      const disabled = EXTERNAL_SOURCES_SEED.filter(s => s.enabled === false).map(s => s.slug).sort()
      expect(disabled).toEqual(['commercial-times', 'moneydj', 'udn-main', 'udn-money'])
    })

    // 這條是 forcing function：getSourceActivity 只看 enabled=true，所以停用來源留在
    // 接受清單裡是死條目——會讓下一個讀清單的人以為那個來源還活著、只是被容忍零產出。
    it('aCCEPTED_ZERO_OUTPUT_SLUGS 不得含停用的來源', () => {
      const disabled = new Set(EXTERNAL_SOURCES_SEED.filter(s => s.enabled === false).map(s => s.slug))
      const overlap = ACCEPTED_ZERO_OUTPUT_SLUGS.filter(slug => disabled.has(slug))
      expect(overlap).toEqual([])
    })

    it('aCCEPTED_ZERO_OUTPUT_SLUGS 的每個 slug 都要真的存在於 seed', () => {
      const known = new Set(EXTERNAL_SOURCES_SEED.map(s => s.slug))
      const unknown = ACCEPTED_ZERO_OUTPUT_SLUGS.filter(slug => !known.has(slug))
      expect(unknown).toEqual([])
    })
  })

  it('rss kind 要有 feedUrl', () => {
    for (const s of EXTERNAL_SOURCES_SEED.filter(s => s.kind === 'rss'))
      expect(s.config).toHaveProperty('feedUrl')
  })

  it('html-selector kind 要有 listingUrl + 4 個 selector', () => {
    for (const s of EXTERNAL_SOURCES_SEED.filter(s => s.kind === 'html-selector')) {
      expect(s.config).toHaveProperty('listingUrl')
      expect(s.config).toHaveProperty('itemSelector')
      expect(s.config).toHaveProperty('titleSelector')
      expect(s.config).toHaveProperty('linkSelector')
      expect(s.config).toHaveProperty('dateSelector')
    }
  })

  // 2026-08-21 規則二：來源層級的「不可引用」。
  // 與規則一（文章層級的「不 enrich」）是兩件事——判準不同、落點不同，別合併。
  describe('aGGREGATOR_PROXY_SLUGS（不可引用的來源）', () => {
    it('★ 判定依據是「這個來源自己的 feedUrl 指向 Google News」，不是文章 url 的 host', () => {
      // 來源歸屬不能靠文章 url 的 host（9 個代理共用
      // news.google.com、按 host 分類會把半個語料庫歸零）。這裡判的是 source 定義自己的
      // feedUrl，是兩件事——而且它自我修正：來源換成直連 feed 就自動變回可引用。
      expect(isAggregatorProxySeed({
        slug: 'x',
        displayName: 'x',
        kind: 'rss',
        tier: 1,
        config: { feedUrl: 'https://news.google.com/rss/search?q=site:example.com' },
      })).toBe(true)
      expect(isAggregatorProxySeed({
        slug: 'x',
        displayName: 'x',
        kind: 'rss',
        tier: 1,
        config: { feedUrl: 'https://www.bloomberg.com/feeds/markets/news.rss' },
      })).toBe(false)
    })

    it('html-selector 沒有 feedUrl → 不是代理', () => {
      expect(isAggregatorProxySeed({
        slug: 'x',
        displayName: 'x',
        kind: 'html-selector',
        tier: 2,
        config: { listingUrl: 'https://news.google.com/x', itemSelector: 'a', titleSelector: 'a', linkSelector: 'a', dateSelector: 'a' },
      })).toBe(false)
    })

    it('清單就是 seed 裡所有 Google News 代理，2026-08-21 實測 7 個各自 100% 錨點 excerpt', () => {
      expect([...AGGREGATOR_PROXY_SLUGS].sort()).toEqual(
        ['brookings', 'csis', 'iea', 'isw', 'reuters-biz', 'reuters-world', 'wsj-markets'],
      )
    })

    it('★ 改直連的兩個不在清單裡——它們的 url 現在是真實網域、可以引用', () => {
      expect(AGGREGATOR_PROXY_SLUGS).not.toContain('bloomberg-markets')
      expect(AGGREGATOR_PROXY_SLUGS).not.toContain('whitehouse-statements')
    })

    it('★ fomc-statements 不在清單裡——它是 title-only（規則一擋 enrich），但 url 可引用', () => {
      // 這一條就是拆成兩個規則的理由。照單一降級組做，Fed 官方聲明會被排除在
      // citation 之外，而它的 url 是真的 federalreserve.gov 連結。
      expect(AGGREGATOR_PROXY_SLUGS).not.toContain('fomc-statements')
    })

    it('清單裡每個 slug 都真的在 seed 裡（防打錯字）', () => {
      const slugs = new Set(EXTERNAL_SOURCES_SEED.map(s => s.slug))
      for (const s of AGGREGATOR_PROXY_SLUGS) expect(slugs).toContain(s)
    })
  })

  // 清單裡的 slug 打錯不會有任何症狀——它只是「沒有被接受」，於是外部監控對一個
  // 不存在的來源保持沉默，而真正該被接受的那個開始被告警。錯的方向是靜默的，所以要釘。
  describe('aCCEPTED_ZERO_OUTPUT_SLUGS（明示接受不告警的零產出來源）', () => {
    it('每個 slug 都真的存在於 seed 裡', () => {
      const known = new Set(EXTERNAL_SOURCES_SEED.map(s => s.slug))
      for (const slug of ACCEPTED_ZERO_OUTPUT_SLUGS)
        expect(known.has(slug), `未知 slug: ${slug}`).toBe(true)
    })

    it('沒有重複', () => {
      expect(new Set(ACCEPTED_ZERO_OUTPUT_SLUGS).size).toBe(ACCEPTED_ZERO_OUTPUT_SLUGS.length)
    })

    // 換過 feed 的七個來源，是「我們相信它會動」的那一組。把它們放進接受清單
    // 等於自己關掉這條告警要抓的東西。
    // ★ udn 兩個曾經是例外（2026-08-21 實測 prod 403、處置未定時明示接受），但它們已於
    //   2026-08-22 隨停用並離開接受清單，所以下面的清單不含它們也不需要含。
    it('換過 feed 的來源不得被接受（udn 兩個除外，已停用）', () => {
      const refeedSlugs = ['bloomberg-markets', 'whitehouse-statements', 'fomc-statements', 'cbc-press', 'liberty-finance']
      for (const slug of refeedSlugs)
        expect(ACCEPTED_ZERO_OUTPUT_SLUGS.includes(slug), `${slug} 不該在接受清單裡`).toBe(false)
    })
  })

  // schema 對齊 db CHECK constraint 含 'official-feed'
  describe('official-feed kind', () => {
    it('accepts official-feed entry with feedUrl + format', () => {
      expect(() => ExternalSourceSeedSchema.parse({
        slug: 'sample-atom',
        displayName: 'Sample Atom Feed',
        kind: 'official-feed',
        tier: 2,
        config: { feedUrl: 'https://example.com/feed.xml', format: 'atom' },
      })).not.toThrow()
    })

    it('accepts tier 1 official-feed', () => {
      expect(() => ExternalSourceSeedSchema.parse({
        slug: 'sample',
        displayName: 'Sample',
        kind: 'official-feed',
        tier: 1,
        config: { feedUrl: 'https://example.com/feed.xml', format: 'rss' },
      })).not.toThrow()
    })

    it('rejects official-feed missing format', () => {
      expect(() => ExternalSourceSeedSchema.parse({
        slug: 'x',
        displayName: 'x',
        kind: 'official-feed',
        tier: 2,
        config: { feedUrl: 'https://example.com/feed.xml' },
      })).toThrow()
    })

    it('rejects official-feed with format not in [atom, rss]', () => {
      expect(() => ExternalSourceSeedSchema.parse({
        slug: 'x',
        displayName: 'x',
        kind: 'official-feed',
        tier: 2,
        config: { feedUrl: 'https://example.com/feed.xml', format: 'json' },
      })).toThrow()
    })
  })
})

describe('aCCEPTED_ZERO_ENRICHMENT_SLUGS', () => {
  it('每一筆都對得上一個實際存在的來源（不留死條目）', () => {
    const slugs = new Set(EXTERNAL_SOURCES_SEED.map(x => x.slug))
    for (const slug of ACCEPTED_ZERO_ENRICHMENT_SLUGS)
      expect(slugs.has(slug), `${slug} 不在 seed 裡`).toBe(true)
  })

  // 這條是 forcing function：Google News 代理群不被 enrich 是規則一刻意擋的，
  // 新增或移除代理來源時這份清單要跟著走，不能靠人記得。
  it('涵蓋所有 Google News 代理來源', () => {
    for (const slug of AGGREGATOR_PROXY_SLUGS)
      expect(ACCEPTED_ZERO_ENRICHMENT_SLUGS).toContain(slug)
  })

  // ★ 不要為了讓告警閉嘴往裡面加東西。非代理來源掉到零 enrich 要修的是正文抓取。
  it('不含任何非代理來源', () => {
    expect([...ACCEPTED_ZERO_ENRICHMENT_SLUGS].sort()).toEqual([...AGGREGATOR_PROXY_SLUGS].sort())
  })
})
