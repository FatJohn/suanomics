import { describe, expect, it, vi } from 'vitest'
import { fetchRssFeed } from './rss-fetcher.js'

describe('fetchRssFeed', () => {
  it('returns xml + url from fetch response', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '<?xml version="1.0"?><rss></rss>',
    }) as unknown as typeof fetch
    const result = await fetchRssFeed({
      url: 'https://example.com/feed.xml',
      fetchImpl: fakeFetch,
    })
    expect(result.xml).toContain('<rss>')
    expect(result.url).toBe('https://example.com/feed.xml')
  })

  it('throws on non-2xx', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => 'not found',
    }) as unknown as typeof fetch
    await expect(fetchRssFeed({
      url: 'https://example.com/feed.xml',
      fetchImpl: fakeFetch,
    })).rejects.toThrow(/404/)
  })
})
