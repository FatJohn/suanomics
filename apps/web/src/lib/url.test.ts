import { describe, expect, it } from 'vitest'
import { isExternalUrl } from './url.js'

describe('isExternalUrl', () => {
  it('shouldAcceptHttpsUrl', () => {
    expect(isExternalUrl('https://x.com/a')).toBe(true)
  })

  it('shouldAcceptHttpUrl', () => {
    expect(isExternalUrl('http://x')).toBe(true)
  })

  it('shouldRejectInternalIdSlug', () => {
    expect(isExternalUrl('spaceX_ipo_inflation_shock')).toBe(false)
  })

  it('shouldRejectEmptyString', () => {
    expect(isExternalUrl('')).toBe(false)
  })

  it('shouldRejectNull', () => {
    expect(isExternalUrl(null)).toBe(false)
  })

  it('shouldRejectRelativePath', () => {
    expect(isExternalUrl('/relative')).toBe(false)
  })

  it('shouldRejectNonHttpProtocol', () => {
    expect(isExternalUrl('ftp://x')).toBe(false)
  })

  it('returns false for data:insufficient sentinel', () => {
    expect(isExternalUrl('data:insufficient')).toBe(false)
  })
})
