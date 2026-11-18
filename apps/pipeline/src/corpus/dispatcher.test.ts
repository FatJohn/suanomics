import { describe, expect, it, vi } from 'vitest'
import { dispatchFetch } from './dispatcher.js'

vi.mock('./sources/rss.js', () => ({ fetchRssSource: vi.fn(async () => [{ externalId: 'r1', url: 'https://r.com/x', title: 'r', publishedAt: null, excerpt: null }]) }))
vi.mock('./sources/html-selector.js', () => ({ fetchHtmlSelector: vi.fn(async () => [{ externalId: null, url: 'https://h.com/x', title: 'h', publishedAt: null, excerpt: null }]) }))

describe('dispatchFetch', () => {
  it('routes kind=rss to RSS fetcher', async () => {
    const entries = await dispatchFetch({ kind: 'rss', config: { feedUrl: 'https://x.com/feed' } })
    expect(entries[0]?.title).toBe('r')
  })

  it('routes kind=html-selector to HTML fetcher', async () => {
    const entries = await dispatchFetch({ kind: 'html-selector', config: { listingUrl: 'https://x.com/list', itemSelector: 'li', titleSelector: 'a', linkSelector: 'a', dateSelector: '.d' } })
    expect(entries[0]?.title).toBe('h')
  })

  it('throws on unknown kind', async () => {
    await expect(dispatchFetch({ kind: 'wat' as never, config: {} as never })).rejects.toThrow(/unknown/)
  })
})
