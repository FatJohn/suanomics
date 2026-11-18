import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchHtmlSelector } from './html-selector.js'

const htmlFixture = readFileSync(new URL('./__fixtures__/html-listing-sample.html', import.meta.url), 'utf-8')

describe('fetchHtmlSelector', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('parses items by selectors', async () => {
    globalThis.fetch = vi.fn(async () => new Response(htmlFixture, { status: 200 })) as never
    const entries = await fetchHtmlSelector({
      listingUrl: 'https://x.com/list',
      itemSelector: 'ul.list > li',
      titleSelector: 'a',
      linkSelector: 'a',
      dateSelector: '.date',
    })
    expect(entries.length).toBe(3)
    expect(entries[0]?.title).toBe('新聞1')
    expect(entries[0]?.url).toMatch(/^https?:/)
    expect(entries[0]?.publishedAt).toBeInstanceOf(Date)
  })

  it('relative URL resolves against listingUrl', async () => {
    globalThis.fetch = vi.fn(async () => new Response(htmlFixture, { status: 200 })) as never
    const entries = await fetchHtmlSelector({
      listingUrl: 'https://x.com/list',
      itemSelector: 'ul.list > li',
      titleSelector: 'a',
      linkSelector: 'a',
      dateSelector: '.date',
    })
    expect(entries[0]?.url).toBe('https://x.com/n1')
  })

  it('missing link → entry skipped', async () => {
    const malformed = '<ul class="list"><li><a>no href</a></li></ul>'
    globalThis.fetch = vi.fn(async () => new Response(malformed, { status: 200 })) as never
    const entries = await fetchHtmlSelector({ listingUrl: 'https://x.com/list', itemSelector: 'ul.list > li', titleSelector: 'a', linkSelector: 'a', dateSelector: '.date' })
    expect(entries).toHaveLength(0)
  })

  it('fail 500 throws', async () => {
    globalThis.fetch = vi.fn(async () => new Response('', { status: 500 })) as never
    await expect(fetchHtmlSelector({ listingUrl: 'https://x.com/list', itemSelector: 'x', titleSelector: 'x', linkSelector: 'x', dateSelector: 'x' })).rejects.toThrow(/status=500/)
  })
})
