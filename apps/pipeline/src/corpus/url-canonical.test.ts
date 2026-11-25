import { describe, expect, it } from 'vitest'
import { canonicalizeUrl, hashCanonicalUrl } from './url-canonical.js'

describe('canonicalizeUrl', () => {
  it('lowercases host', () => {
    expect(canonicalizeUrl('https://WWW.Bloomberg.com/news/abc')).toBe('https://www.bloomberg.com/news/abc')
  })

  it('strips utm_* tracking params', () => {
    expect(canonicalizeUrl('https://a.com/x?id=1&utm_source=twitter&utm_campaign=q2'))
      .toBe('https://a.com/x?id=1')
  })

  it('strips fbclid and gclid', () => {
    expect(canonicalizeUrl('https://a.com/x?fbclid=abc&gclid=def&keep=yes'))
      .toBe('https://a.com/x?keep=yes')
  })

  it('strips trailing slash from path (not root)', () => {
    expect(canonicalizeUrl('https://a.com/foo/')).toBe('https://a.com/foo')
    expect(canonicalizeUrl('https://a.com/')).toBe('https://a.com/')
  })

  it('strips fragment', () => {
    expect(canonicalizeUrl('https://a.com/x#section')).toBe('https://a.com/x')
  })

  it('sorts remaining query params for stable hash', () => {
    expect(canonicalizeUrl('https://a.com/x?b=2&a=1')).toBe('https://a.com/x?a=1&b=2')
  })

  it('preserves port if non-default', () => {
    expect(canonicalizeUrl('https://a.com:8443/x')).toBe('https://a.com:8443/x')
  })

  it('throws on invalid URL', () => {
    expect(() => canonicalizeUrl('not a url')).toThrow()
  })
})

describe('hashCanonicalUrl', () => {
  it('returns stable SHA256 hex for same canonical input', () => {
    const a = hashCanonicalUrl('https://a.com/x?b=2&a=1')
    const b = hashCanonicalUrl('https://a.com/x?a=1&b=2')
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })

  it('different URLs → different hashes', () => {
    expect(hashCanonicalUrl('https://a.com/x')).not.toBe(hashCanonicalUrl('https://a.com/y'))
  })
})
