import { describe, expect, it } from 'vitest'
import { hashArticleContent } from './content-hash.js'

describe('hashArticleContent', () => {
  it('returns null when input null/empty', () => {
    expect(hashArticleContent(null)).toBeNull()
    expect(hashArticleContent('')).toBeNull()
    expect(hashArticleContent('   \n  ')).toBeNull()
  })

  it('returns SHA256 hex for non-empty input', () => {
    expect(hashArticleContent('hello world')).toMatch(/^[0-9a-f]{64}$/)
  })

  it('normalizes whitespace (collapse + trim)', () => {
    expect(hashArticleContent('a\n\n  b   c')).toBe(hashArticleContent('a b c'))
  })

  it('different content → different hash', () => {
    expect(hashArticleContent('hello')).not.toBe(hashArticleContent('world'))
  })
})
