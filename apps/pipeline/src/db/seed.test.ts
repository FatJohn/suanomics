import { describe, expect, it } from 'vitest'
import { ACCEPTED_ZERO_USABLE_NEWS_SLUGS, isGoogleNewsProxySeed, RETIRED_SLUGS, SEED } from './seed.js'

describe('news_sources SEED', () => {
  it('slug 唯一', () => {
    const slugs = SEED.map(s => s.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it('每筆 rssUrl 是合法 https URL', () => {
    for (const s of SEED) {
      expect(s.rssUrl, `${s.slug} 非 https`).toMatch(/^https:\/\//)
      expect(() => new URL(s.rssUrl), `${s.slug} URL 不合法`).not.toThrow()
    }
  })

  it('active 來源 rssUrl 非空', () => {
    for (const s of SEED.filter(x => x.isActive))
      expect(s.rssUrl.length, `${s.slug} rssUrl 空`).toBeGreaterThan(0)
  })

  it('包含繁中總經 Google News 查詢來源且 active', () => {
    const macroSlugs = ['google-news-us-macro', 'google-news-oil', 'google-news-cbc', 'google-news-china']
    for (const slug of macroSlugs) {
      const entry = SEED.find(s => s.slug === slug)
      expect(entry, `缺 macro 來源 ${slug}`).toBeDefined()
      expect(entry?.isActive, `${slug} 應 active`).toBe(true)
    }
  })

  it('sEED 至少 10 筆（原 6 + 新增 ≥ 4）', () => {
    expect(SEED.length).toBeGreaterThanOrEqual(10)
  })

  it('退役來源不在 SEED 裡（SEED 就是現役清單）', () => {
    for (const slug of RETIRED_SLUGS)
      expect(SEED.find(s => s.slug === slug), `${slug} 已退役、不該還在 SEED`).toBeUndefined()
  })

  it('sEED 內每一筆都是 active（不現役的請進 RETIRED_SLUGS）', () => {
    for (const s of SEED)
      expect(s.isActive, `${s.slug} 在 SEED 裡卻是 inactive`).toBe(true)
  })

  // ★ 這三個是 2026-08-28 換掉的：原本走 Google News site: 代理、content_text
  // 只有錨點 markup，換成發行商直連 feed 之後 link 指向真網址、scraper 才抓得到正文。
  // 寫死 host 是為了讓「手滑改回代理」這件事在測試層就紅——換回去等於偷偷把它們
  // 加進 ACCEPTED_ZERO_USABLE_NEWS_SLUGS 的豁免名單。
  it('三個台股出版社來源是直連發行商、不是 Google News 代理', () => {
    const expected: Record<string, string> = {
      'google-news-udn': 'money.udn.com',
      'google-news-yahoo-stock': 'tw.stock.yahoo.com',
      'google-news-cnyes': 'news.cnyes.com',
    }
    for (const [slug, host] of Object.entries(expected)) {
      const entry = SEED.find(s => s.slug === slug)
      expect(entry, `缺台股來源 ${slug}`).toBeDefined()
      if (entry === undefined)
        continue
      expect(entry.isActive, `${slug} 應 active`).toBe(true)
      expect(new URL(entry.rssUrl).host, `${slug} 應直連 ${host}`).toBe(host)
      expect(isGoogleNewsProxySeed(entry), `${slug} 不該是代理`).toBe(false)
    }
  })

  // ★ 2026-08-28 補進來的來源。寫死 host 的理由同上：這幾個都是實測過
  // 「feed 活著＋scraper 抓得到正文」才加的，被改成別的 host 等於推翻那個實測。
  it('補進來的新聞來源都是直連、且 active', () => {
    const expected: Record<string, string> = {
      'nextapple-finance': 'news.nextapple.com',
      'technews': 'technews.tw',
      'cnyes-world': 'news.cnyes.com',
      'udn-markets': 'money.udn.com',
      'udn-global': 'money.udn.com',
    }
    for (const [slug, host] of Object.entries(expected)) {
      const entry = SEED.find(s => s.slug === slug)
      expect(entry, `缺來源 ${slug}`).toBeDefined()
      if (entry === undefined)
        continue
      expect(entry.isActive, `${slug} 應 active`).toBe(true)
      expect(new URL(entry.rssUrl).host, `${slug} 應直連 ${host}`).toBe(host)
      expect(isGoogleNewsProxySeed(entry), `${slug} 不該是代理`).toBe(false)
    }
  })

  // ★ 同一個 host 開多個分類時，分類參數必須真的不一樣——複製貼上少改一個數字，
  // 症狀是「多了一個來源但抓到的是同一批文章」，而 (source_id, external_id) 的
  // unique 約束擋不住它（不同 source_id 就是兩筆）。
  it('同一 host 的多個分類來源，feed URL 兩兩不同', () => {
    const byHost = new Map<string, string[]>()
    for (const s of SEED) {
      const h = new URL(s.rssUrl).host
      byHost.set(h, [...(byHost.get(h) ?? []), s.rssUrl])
    }
    for (const [host, urls] of byHost) {
      if (host === 'news.google.com')
        continue
      expect(new Set(urls).size, `${host} 有重複的 feed URL`).toBe(urls.length)
    }
  })

  // ctee 沒有可用的公開 feed，且站方 robots.txt 不允許自動化存取，所以仍走代理。
  it('google-news-ctee 仍是代理（直連 feed 未解）', () => {
    const entry = SEED.find(s => s.slug === 'google-news-ctee')
    expect(entry?.isActive).toBe(true)
    expect(entry && isGoogleNewsProxySeed(entry)).toBe(true)
  })

  it('每筆都有合法 category（tw-equity | macro）', () => {
    const allowed = new Set(['tw-equity', 'macro'])
    for (const s of SEED)
      expect(allowed.has(s.category), `${s.slug} category 非法：${s.category}`).toBe(true)
  })

  it('分類落點 spot-check（台股 feed → tw-equity、總經/能源 feed → macro）', () => {
    const find = (slug: string) => SEED.find(s => s.slug === slug)
    expect(find('cna')?.category).toBe('tw-equity')
    expect(find('google-news-cnyes')?.category).toBe('tw-equity')
    expect(find('eia')?.category).toBe('macro')
    expect(find('google-news-us-macro')?.category).toBe('macro')
  })
})

describe('isGoogleNewsProxySeed', () => {
  it('依 rss_url 的 host 判定，不看 slug 也不看 displayName', () => {
    // bloomberg-markets / wsj-markets 的 slug 與 displayName 都看不出是代理，
    // 但它們的 feed 是 news.google.com/rss/search?q=site:...——用 slug 猜會漏掉。
    const bloomberg = SEED.find(s => s.slug === 'bloomberg-markets')
    expect(bloomberg && isGoogleNewsProxySeed(bloomberg)).toBe(true)
    const ltn = SEED.find(s => s.slug === 'ltn-business')
    expect(ltn && isGoogleNewsProxySeed(ltn)).toBe(false)
  })

  it('壞掉的 rss_url 回 false 而不是拋', () => {
    expect(isGoogleNewsProxySeed({ slug: 'x', displayName: 'x', rssUrl: 'not a url', isActive: true, category: 'macro' })).toBe(false)
  })

  // 參數型別只要求 `rssUrl`（判準本來就只看它）。放寬是為了讓 news:health 這種
  // 拿 DB 的 news_sources 列（沒有 category 欄）的呼叫端能直接重用同一個判準，
  // 而不是各自再寫一份 host 比對——兩份實作遲早分岔。
  it('只需要 rssUrl 就能判定（呼叫端不必湊出完整 SeedEntry）', () => {
    expect(isGoogleNewsProxySeed({ rssUrl: 'https://news.google.com/rss/search?q=x' })).toBe(true)
    expect(isGoogleNewsProxySeed({ rssUrl: 'https://news.ltn.com.tw/rss/business.xml' })).toBe(false)
  })

  // host 精確比對：news.google.com.evil.example 不該被當成代理而拿到豁免。
  it('只認 host 完全相等，不做子字串比對', () => {
    expect(isGoogleNewsProxySeed({ slug: 'x', displayName: 'x', rssUrl: 'https://news.google.com.evil.example/rss', isActive: true, category: 'macro' })).toBe(false)
  })
})

// 日報來源的 zeroUsable 判定要有明示接受清單，否則告警上線第一天就會對著
// Google News 代理群開火——它們的 content_text 是錨點 markup，非空但資訊量為零，
// 那是 feed 本身的形狀，不是回歸。2026-08-23 對 prod 近 7 天量過：18 個啟用來源裡
// 「一篇都沒有超出標題」的正好是當時那 13 個代理，其餘 5 個是 160/160、67/67 這種全通過。
// （2026-08-28 之後是 10 個——清單是推導的，數字每次換 feed 都會變。）
describe('aCCEPTED_ZERO_USABLE_NEWS_SLUGS', () => {
  it('涵蓋所有啟用中的 Google News 代理', () => {
    const proxies = SEED.filter(s => s.isActive && isGoogleNewsProxySeed(s)).map(s => s.slug).sort()
    expect([...ACCEPTED_ZERO_USABLE_NEWS_SLUGS].sort()).toEqual(proxies)
  })

  // ★ 不要為了讓告警閉嘴往裡面加東西：非代理來源掉到零可用，要修的是正文抓取。
  it('不含任何非代理來源', () => {
    for (const slug of ACCEPTED_ZERO_USABLE_NEWS_SLUGS) {
      const seed = SEED.find(s => s.slug === slug)
      expect(seed && isGoogleNewsProxySeed(seed), `${slug} 不是 Google News 代理`).toBe(true)
    }
  })

  it('不含停用來源（停用來源不進健康判定，留著只是死條目）', () => {
    const inactive = new Set(SEED.filter(s => !s.isActive).map(s => s.slug))
    for (const slug of ACCEPTED_ZERO_USABLE_NEWS_SLUGS)
      expect(inactive.has(slug), `${slug} 已停用`).toBe(false)
  })
})

// 退役＝從 SEED 移除**並且**在 DB 裡停用。只從 SEED 刪掉不夠：seed 只做 upsert，
// 刪掉陣列裡那一列等於把 DB 的狀態凍結在當下——本機 DB 的 anue 與 udn-money
// 在退役之前都還是 is_active = t，光刪陣列它們會繼續被抓。
describe('rETIRED_SLUGS', () => {
  it('涵蓋 2026-08-28 清掉的三個死設定', () => {
    expect([...RETIRED_SLUGS].sort()).toEqual(['anue', 'tvbs', 'udn-money'])
  })

  it('與 SEED 的 slug 沒有交集', () => {
    const seeded = new Set(SEED.map(s => s.slug))
    for (const slug of RETIRED_SLUGS)
      expect(seeded.has(slug), `${slug} 同時出現在 SEED 與 RETIRED_SLUGS`).toBe(false)
  })
})
