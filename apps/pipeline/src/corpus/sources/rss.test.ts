import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchRssSource } from './rss.js'

const xmlFixture = readFileSync(new URL('./__fixtures__/rss-sample.xml', import.meta.url), 'utf-8')
const cnyesFixture = readFileSync(new URL('./__fixtures__/cnyes-sample.json', import.meta.url), 'utf-8')
const twseNewsFixture = readFileSync(new URL('./__fixtures__/twse-newslist-sample.json', import.meta.url), 'utf-8')

describe('fetchRssSource', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  // TWSE OpenAPI 的 news/newsList。三個欄位 Title / Url / Date，Date 是民國 yyyymmdd
  // 的**日期字串、不帶時間**——所以時區語意必須在這裡釘死，否則下游的相對日期標籤會差一天。
  // 選台北零點（不是 UTC 零點）：TWSE 公告的日期本來就是台北日期。
  describe('twse-news-json', () => {
    it('解析出 title / url，民國日期轉成台北零點', async () => {
      globalThis.fetch = vi.fn(async () => new Response(twseNewsFixture, { status: 200 })) as never
      const entries = await fetchRssSource({ feedUrl: 'https://openapi.twse.com.tw/v1/news/newsList', format: 'twse-news-json' })

      expect(entries).toHaveLength(3)
      for (const e of entries) {
        expect(e.url).toMatch(/^https:\/\/www\.twse\.com\.tw\//)
        expect(e.title).not.toBe('')
        expect(e.publishedAt).toBeInstanceOf(Date)
      }
      // 民國 1150821 ＝ 2026-08-21 台北 00:00 ＝ 2026-08-20T16:00:00Z
      expect(entries[0]?.publishedAt?.toISOString()).toBe('2026-08-20T16:00:00.000Z')
      expect(entries[0]?.title).toContain('發行量加權股價指數')
    })

    it('缺 Url 或 Title 的列會被丟掉，不會產生 url 為空字串的 entry', async () => {
      const malformed = JSON.stringify([
        { Title: '有標題沒網址', Date: '1150821' },
        { Url: 'https://www.twse.com.tw/x', Date: '1150821' },
        { Title: '完整的', Url: 'https://www.twse.com.tw/ok', Date: '1150821' },
      ])
      globalThis.fetch = vi.fn(async () => new Response(malformed, { status: 200 })) as never
      const entries = await fetchRssSource({ feedUrl: 'https://x/y', format: 'twse-news-json' })
      expect(entries).toHaveLength(1)
      expect(entries[0]?.title).toBe('完整的')
    })

    it('日期缺漏或格式不對時 publishedAt 是 null，不是 Invalid Date', async () => {
      const noDate = JSON.stringify([{ Title: 't', Url: 'https://www.twse.com.tw/a', Date: '' }])
      globalThis.fetch = vi.fn(async () => new Response(noDate, { status: 200 })) as never
      const entries = await fetchRssSource({ feedUrl: 'https://x/y', format: 'twse-news-json' })
      expect(entries[0]?.publishedAt).toBeNull()
    })
  })

  it('standard RSS: returns parsed entries', async () => {
    globalThis.fetch = vi.fn(async () => new Response(xmlFixture, { status: 200, headers: { 'content-type': 'application/xml' } })) as never
    const entries = await fetchRssSource({ feedUrl: 'https://example.com/feed' })
    expect(entries.length).toBeGreaterThan(0)
    for (const e of entries) {
      expect(e.url).toMatch(/^https?:\/\//)
      expect(e.title).not.toBe('')
    }
  })

  // ★ 這個樣本 2026-08-22 被 `pnpm fixtures:check` 抓到形狀是錯的：它原本有一個
  //   `url` 欄位，而真實 API **不回 url**（實測回應的 28 個欄位裡沒有它）。於是
  //   `strOrNull(i.url) ?? 衍生網址` 這行在 production 永遠走衍生那條，而測試永遠走
  //   另一條——測的是一條不會執行的分支。樣本已改成與現實相符，斷言跟著補上。
  it('cnyes-json format: 由 newsId 衍生網址（真實 API 不回 url）', async () => {
    globalThis.fetch = vi.fn(async () => new Response(cnyesFixture, { status: 200, headers: { 'content-type': 'application/json' } })) as never
    const entries = await fetchRssSource({ feedUrl: 'https://api.cnyes.com/media/api/v1/newslist/category/headline?limit=3', format: 'cnyes-json' })
    expect(entries).toHaveLength(3)
    expect(entries[0]).toMatchObject({
      externalId: '5001',
      url: 'https://news.cnyes.com/news/id/5001',
      title: '鉅亨新聞一',
      excerpt: '摘要一',
    })
    expect(entries[0]?.publishedAt).toEqual(new Date(1745400000 * 1000))
  })

  // 衍生網址靠 newsId。newsId 也缺的話會組出 `.../news/id/`——非空字串，所以
  // `filter(e => e.url && e.title)` 擋不掉，一個點不開的網址會進 corpus。
  it('cnyes-json format: newsId 也缺時會產生沒有 id 的網址（已知缺口，先釘住行為）', async () => {
    const body = JSON.stringify({ items: { data: [{ title: '無 id 的新聞', summary: 's', publishAt: 1745400000 }] } })
    globalThis.fetch = vi.fn(async () => new Response(body, { status: 200, headers: { 'content-type': 'application/json' } })) as never
    const entries = await fetchRssSource({ feedUrl: 'https://x.invalid', format: 'cnyes-json' })
    expect(entries[0]?.url).toBe('https://news.cnyes.com/news/id/')
  })

  it('throws on non-200', async () => {
    globalThis.fetch = vi.fn(async () => new Response('', { status: 500 })) as never
    await expect(fetchRssSource({ feedUrl: 'https://x.com/feed' })).rejects.toThrow(/status=500/)
  })

  it('throws on timeout', async () => {
    globalThis.fetch = vi.fn(async () => {
      await new Promise(r => setTimeout(r, 100))
      throw new Error('abort')
    }) as never
    await expect(fetchRssSource({ feedUrl: 'https://x.com/feed', timeoutMs: 50 })).rejects.toThrow()
  })
})
