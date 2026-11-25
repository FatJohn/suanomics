import { describe, expect, it } from 'vitest'
import { summarizeNewsHealth } from './health.js'

const NOW = new Date('2026-08-28T12:00:00Z')

function source(over: Partial<Parameters<typeof summarizeNewsHealth>[0]['sources'][number]> = {}) {
  return {
    slug: 's',
    displayName: 'S',
    rssUrl: 'https://example.com/rss',
    isActive: true,
    totalItems: 0,
    ...over,
  }
}

function item(over: Partial<Parameters<typeof summarizeNewsHealth>[0]['items'][number]> = {}) {
  return {
    slug: 's',
    title: '標題',
    contentText: '標題\n這是一段真的正文，長度足夠超出標題本身。',
    contentSource: 'scrape',
    publishedAt: new Date('2026-08-28T02:00:00Z'),
    ...over,
  }
}

describe('summarizeNewsHealth', () => {
  it('沒有任何 item 的來源也要出現在報告裡（否則整個來源消失＝看不見它壞了）', () => {
    const rows = summarizeNewsHealth({ sources: [source()], items: [] }, NOW)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.inWindow).toBe(0)
    expect(rows[0]?.usable).toBe(0)
    expect(rows[0]?.latestPublishedAt).toBeNull()
    expect(rows[0]?.stalenessDays).toBeNull()
  })

  it('依 content_source 分桶計數', () => {
    const rows = summarizeNewsHealth({
      sources: [source()],
      items: [
        item({ contentSource: 'scrape' }),
        item({ contentSource: 'scrape' }),
        item({ contentSource: 'rss-excerpt' }),
      ],
    }, NOW)
    expect(rows[0]?.byContentSource).toEqual({ 'scrape': 2, 'rss-excerpt': 1 })
    expect(rows[0]?.inWindow).toBe(3)
  })

  // ★ 可用＝超出標題，不是「非空」。Google News 代理的 content_text 是錨點 markup，
  // 非空、幾百字元，剝掉標記之後剛好等於標題——用非空判會全綠。
  it('可用則數用 hasBodyBeyondTitle，不是「content_text 非空」', () => {
    const anchor = '<a href="https://news.google.com/rss/articles/CBM">標題</a>&nbsp;&nbsp;經濟日報'
    const rows = summarizeNewsHealth({
      sources: [source()],
      // Google News 的 item title 是「標題 - 發行商」，excerpt 剝完剛好等於它。
      items: [item({ title: '標題 - 經濟日報', contentText: anchor }), item()],
    }, NOW)
    expect(rows[0]?.inWindow).toBe(2)
    expect(rows[0]?.usable).toBe(1)
  })

  it('內文長度取百分位（nearest-rank、含沒有內文的那些）', () => {
    const lens = [0, 100, 200, 300, 400, 500, 600, 700, 800, 900]
    const rows = summarizeNewsHealth({
      sources: [source()],
      items: lens.map(n => item({ contentText: n === 0 ? null : 'x'.repeat(n) })),
    }, NOW)
    expect(rows[0]?.bodyLenP50).toBe(400)
    expect(rows[0]?.bodyLenP90).toBe(800)
  })

  it('代理判定沿用 isGoogleNewsProxySeed（看 rss_url 的 host、不看名字）', () => {
    const rows = summarizeNewsHealth({
      sources: [
        source({ slug: 'proxy', displayName: '看不出是代理', rssUrl: 'https://news.google.com/rss/search?q=site:x.com' }),
        source({ slug: 'direct', rssUrl: 'https://money.udn.com/rssfeed/news/1001/5591' }),
      ],
      items: [],
    }, NOW)
    expect(rows.find(r => r.slug === 'proxy')?.isProxy).toBe(true)
    expect(rows.find(r => r.slug === 'direct')?.isProxy).toBe(false)
  })

  describe('flags — 三種「看起來健康其實是壞的」', () => {
    it('silent：啟用中但窗內零則', () => {
      const rows = summarizeNewsHealth({ sources: [source()], items: [] }, NOW)
      expect(rows[0]?.flags).toContain('silent')
    })

    it('停用來源不掛 silent（它本來就不該有東西）', () => {
      const rows = summarizeNewsHealth({ sources: [source({ isActive: false })], items: [] }, NOW)
      expect(rows[0]?.flags).toEqual([])
    })

    it('title-only：窗內有則數但一則都沒有超出標題', () => {
      const rows = summarizeNewsHealth({
        sources: [source()],
        items: [item({ title: '標題', contentText: '標題' })],
      }, NOW)
      expect(rows[0]?.flags).toContain('title-only')
    })

    it('no-scrape：窗內有則數但沒有任何一則抓到正文（全是 rss-excerpt）', () => {
      const rows = summarizeNewsHealth({
        sources: [source()],
        items: [item({ contentSource: 'rss-excerpt' })],
      }, NOW)
      expect(rows[0]?.flags).toContain('no-scrape')
    })

    // ★ HTTP 200＋有內容仍可能是殭屍 feed：WSJ 停更 19 個月、CSIS 停更 10 年，
    // 兩者都是 200 且 description 有真正文。只有 pubDate 分得出來。
    it('zombie：窗內抓得到東西，但最新一則的 pubDate 已經超過門檻', () => {
      const rows = summarizeNewsHealth({
        sources: [source()],
        items: [item({ publishedAt: new Date('2025-01-10T00:00:00Z') })],
      }, NOW)
      expect(rows[0]?.flags).toContain('zombie')
      expect(rows[0]?.stalenessDays).toBe(595)
    })

    it('publishedAt 全 null 時不判 zombie（沒有量到，不是壞了）', () => {
      const rows = summarizeNewsHealth({
        sources: [source()],
        items: [item({ publishedAt: null })],
      }, NOW)
      expect(rows[0]?.stalenessDays).toBeNull()
      expect(rows[0]?.flags).not.toContain('zombie')
    })

    it('新鮮的來源不掛任何 flag', () => {
      const rows = summarizeNewsHealth({ sources: [source()], items: [item()] }, NOW)
      expect(rows[0]?.flags).toEqual([])
    })
  })

  it('依 slug 排序，讓兩次跑的輸出可以直接 diff', () => {
    const rows = summarizeNewsHealth({
      sources: [source({ slug: 'zzz' }), source({ slug: 'aaa' })],
      items: [],
    }, NOW)
    expect(rows.map(r => r.slug)).toEqual(['aaa', 'zzz'])
  })
})
