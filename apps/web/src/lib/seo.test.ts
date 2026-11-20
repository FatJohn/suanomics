import { describe, expect, it } from 'vitest'
import { absoluteUrl, DEFAULT_DESCRIPTION, metaDescription, sitemapXml } from './seo'

const SITE = 'https://suanomics.everbegin.net'

describe('absoluteUrl', () => {
  it('adds a trailing slash to page paths, matching the 308 redirect Cloudflare Pages serves', () => {
    expect(absoluteUrl('/dates', SITE)).toBe('https://suanomics.everbegin.net/dates/')
    expect(absoluteUrl('/d/2026-11-19', SITE)).toBe('https://suanomics.everbegin.net/d/2026-11-19/')
  })

  it('keeps the root and already-slashed paths as they are', () => {
    expect(absoluteUrl('/', SITE)).toBe('https://suanomics.everbegin.net/')
    expect(absoluteUrl('/dates/', SITE)).toBe('https://suanomics.everbegin.net/dates/')
  })

  it('leaves file paths without a trailing slash', () => {
    expect(absoluteUrl('/og-image.png', SITE)).toBe('https://suanomics.everbegin.net/og-image.png')
    expect(absoluteUrl('/sitemap.xml', SITE)).toBe('https://suanomics.everbegin.net/sitemap.xml')
  })

  it('ignores a trailing slash on the site origin', () => {
    expect(absoluteUrl('/dates', `${SITE}/`)).toBe('https://suanomics.everbegin.net/dates/')
  })
})

describe('metaDescription', () => {
  it('collapses whitespace and newlines into single spaces', () => {
    expect(metaDescription('  美債殖利率\n\n走高，  台股電子承壓 ')).toBe('美債殖利率 走高， 台股電子承壓')
  })

  it('falls back to the site description when the text is empty', () => {
    expect(metaDescription(undefined)).toBe(DEFAULT_DESCRIPTION)
    expect(metaDescription('   ')).toBe(DEFAULT_DESCRIPTION)
  })

  it('keeps text at the limit untouched', () => {
    const text = '字'.repeat(100)
    expect(metaDescription(text)).toBe(text)
  })

  it('cuts longer text to the limit, ending with an ellipsis', () => {
    const result = metaDescription('字'.repeat(101))
    expect(result).toBe(`${'字'.repeat(99)}…`)
    expect(Array.from(result)).toHaveLength(100)
  })

  it('counts characters by code point so a cut never splits a surrogate pair', () => {
    const result = metaDescription('𠮷'.repeat(5), 3)
    expect(result).toBe('𠮷𠮷…')
  })
})

describe('sitemapXml', () => {
  it('lists each URL with its lastmod when given', () => {
    const xml = sitemapXml([
      { loc: 'https://suanomics.everbegin.net/' },
      { loc: 'https://suanomics.everbegin.net/d/2026-11-19/', lastmod: '2026-11-19' },
    ])
    expect(xml).toBe([
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      '<url><loc>https://suanomics.everbegin.net/</loc></url>',
      '<url><loc>https://suanomics.everbegin.net/d/2026-11-19/</loc><lastmod>2026-11-19</lastmod></url>',
      '</urlset>',
      '',
    ].join('\n'))
  })

  it('escapes XML special characters in URLs', () => {
    expect(sitemapXml([{ loc: 'https://e.test/?a=1&b=<2>' }]))
      .toContain('<loc>https://e.test/?a=1&amp;b=&lt;2&gt;</loc>')
  })
})
