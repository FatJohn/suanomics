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

  it('shouldReturnEmptyForInvalidXml', () => {
    expect(parseRssXml('not xml at all')).toEqual([])
  })
})
