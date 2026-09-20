import { describe, expect, it } from 'vitest'
import { safeEqual } from './safe-equal.js'

describe('safeEqual', () => {
  it('returns true for identical strings', () => {
    expect(safeEqual('secret123', 'secret123')).toBe(true)
  })

  it('returns false for different strings of the same length', () => {
    expect(safeEqual('secret123', 'secret456')).toBe(false)
  })

  it('returns false — not throws — for strings of different length', () => {
    expect(() => safeEqual('short', 'a-much-longer-string')).not.toThrow()
    expect(safeEqual('short', 'a-much-longer-string')).toBe(false)
  })

  it('returns true for two empty strings', () => {
    expect(safeEqual('', '')).toBe(true)
  })

  it('handles non-ASCII strings correctly', () => {
    expect(safeEqual('祕密金鑰', '祕密金鑰')).toBe(true)
    expect(safeEqual('祕密金鑰', '不一樣的字')).toBe(false)
  })
})
