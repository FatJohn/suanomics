import { describe, expect, it } from 'vitest'
import { parseRssXml } from './rss-fetcher.js'

const sampleFeed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<item>
  <title>台積電財報優於預期</title>
  <link>https://news.example.com/money/2626001</link>
  <guid>2626001</guid>
  <pubDate>Mon, 20 Apr 2026 09:00:00 +0800</pubDate>
  <description>半導體產業復甦…</description>
</item>
</channel></rss>`

describe('parseRssXml', () => {
  it('shouldParseEntriesWithAllFields', () => {
    const entries = parseRssXml(sampleFeed)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      externalId: '2626001',
      title: '台積電財報優於預期',
      url: 'https://news.example.com/money/2626001',
    })
    expect(entries[0]?.publishedAt?.toISOString().startsWith('2026-04-20')).toBe(true)
  })

  it('shouldFallbackToUrlHashWhenGuidMissing', () => {
    const xml = `<?xml version="1.0"?><rss><channel><item><title>T</title><link>http://x/abc</link><description>d</description></item></channel></rss>`
    const entries = parseRssXml(xml)
    expect(entries[0]?.externalId).toBeTruthy()
    expect(entries[0]?.externalId.length).toBeGreaterThan(0)
  })

  // 金管會 feed 的 link 在 XML 解一次之後仍是 `&amp;`，直接抓會落到列表頁，抽出的是分頁字樣而不是正文。
  it('shouldDecodeDoubleEscapedAmpersandInLink', () => {
    const xml = `<rss><channel><item><title>T</title><link>https://x/home.jsp?id=96&amp;amp;dataserno=1</link></item></channel></rss>`
    expect(parseRssXml(xml)[0]?.url).toBe('https://x/home.jsp?id=96&dataserno=1')
  })

  it('shouldReturnEmptyForInvalidXml', () => {
    expect(parseRssXml('not xml at all')).toEqual([])
  })
})
