import { describe, expect, it } from 'vitest'
import { computeInputHash, computeInputUrl, normalizeUrl } from './cache-key.js'

describe('normalizeUrl', () => {
  it('strips utm_* params', () => {
    expect(normalizeUrl('https://x.com/a?utm_source=fb&utm_medium=cpc&q=1'))
      .toBe('https://x.com/a?q=1')
  })
  it('strips fragment', () => {
    expect(normalizeUrl('https://x.com/a#section')).toBe('https://x.com/a')
  })
  it('strips trailing slash', () => {
    expect(normalizeUrl('https://x.com/a/')).toBe('https://x.com/a')
    expect(normalizeUrl('https://x.com/')).toBe('https://x.com')
  })
  it('preserves non-utm params', () => {
    expect(normalizeUrl('https://x.com/a?utm_source=x&q=1&page=2'))
      .toBe('https://x.com/a?q=1&page=2')
  })
  it('handles uppercase utm_ variant', () => {
    expect(normalizeUrl('https://x.com/a?UTM_SOURCE=fb&q=1'))
      .toBe('https://x.com/a?q=1')
  })
})

describe('computeInputHash', () => {
  it('hashes normalized url when url provided', () => {
    const a = computeInputHash({ url: 'https://x.com/a?utm_source=x', title: 'T', content: 'C' })
    const b = computeInputHash({ url: 'https://x.com/a', title: 'DIFFERENT', content: 'OTHER' })
    expect(a).toBe(b) // url-priority、title/content 不影響 hash
  })
  it('hashes title+content when no url', () => {
    const a = computeInputHash({ title: 'T1', content: 'C1' })
    const b = computeInputHash({ title: 'T1', content: 'C1' })
    const c = computeInputHash({ title: 'T2', content: 'C1' })
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })
  it('returns sha256 hex (64 chars)', () => {
    const h = computeInputHash({ title: 'T', content: 'C' })
    expect(h).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('computeInputUrl', () => {
  it('returns normalized url when provided', () => {
    expect(computeInputUrl({ url: 'https://x.com/a?utm_source=fb', title: 'T', content: 'C' }))
      .toBe('https://x.com/a')
  })
  it('returns null when no url', () => {
    expect(computeInputUrl({ title: 'T', content: 'C' })).toBeNull()
  })
})
