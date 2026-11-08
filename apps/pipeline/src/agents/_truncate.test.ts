import { describe, expect, it } from 'vitest'
import { clampString, splitSentences, truncateAtSentence, truncateString } from './_truncate.js'

describe('clampString', () => {
  it('returns input unchanged when within max', () => {
    expect(clampString('abc', 10)).toBe('abc')
    expect(clampString('abc', 3)).toBe('abc')
  })
  it('truncates and adds ellipsis when over max', () => {
    expect(clampString('abcdef', 4)).toBe('abc…')
  })
  it('handles empty string', () => {
    expect(clampString('', 5)).toBe('')
  })
})

describe('truncateString', () => {
  it('returns string unchanged when under or equal to max', () => {
    expect(truncateString('hello', 10)).toBe('hello')
    expect(truncateString('1234567890', 10)).toBe('1234567890')
  })

  it('truncates to max-1 chars + ellipsis when over max', () => {
    const out = truncateString('123456', 5)
    expect(typeof out).toBe('string')
    expect((out as string).length).toBe(5)
    expect(out).toBe('1234…')
  })

  it('passes through non-string input unchanged', () => {
    expect(truncateString(42, 10)).toBe(42)
    expect(truncateString(null, 10)).toBe(null)
    expect(truncateString({ a: 1 }, 10)).toEqual({ a: 1 })
  })
})

describe('truncateAtSentence', () => {
  it('returns string unchanged when within max', () => {
    expect(truncateAtSentence('短句。', 10)).toBe('短句。')
    expect(truncateAtSentence('1234567890', 10)).toBe('1234567890')
  })

  it('truncates to last 。 within max, no ellipsis', () => {
    const out = truncateAtSentence('第一句。第二句很長很長很長', 8) as string
    expect(out).toBe('第一句。')
    expect(out).not.toContain('…')
  })

  it('truncates at ！ and ？ too', () => {
    expect(truncateAtSentence('問了嗎？接著還有很多字要被切掉', 6)).toBe('問了嗎？')
    expect(truncateAtSentence('很好！後面一長串字要被切掉啦', 4)).toBe('很好！')
  })

  it('includes trailing closing bracket after sentence ender', () => {
    const out = truncateAtSentence('他說「買進。」然後又講了一大串多餘的話', 7) as string
    expect(out).toBe('他說「買進。」')
  })

  it('keeps sentence ender exactly at max boundary', () => {
    expect(truncateAtSentence('一二三。尾', 4)).toBe('一二三。')
  })

  it('falls back to hard cut (no ellipsis) when no sentence boundary', () => {
    const out = truncateAtSentence('一二三四五六七八九十', 5) as string
    expect(out).toBe('一二三四五')
    expect(out).not.toContain('…')
  })

  it('falls back to hard cut when boundary earlier than minLen', () => {
    // 。在 index1（cut=2）但 minLen=5 → fallback slice(0,6)
    expect(truncateAtSentence('好。一二三四五六七八', 6, 5)).toBe('好。一二三四')
  })

  it('passes through non-string input unchanged', () => {
    expect(truncateAtSentence(42, 10)).toBe(42)
    expect(truncateAtSentence(null, 10)).toBe(null)
    expect(truncateAtSentence({ a: 1 }, 10)).toEqual({ a: 1 })
  })

  it('handles empty string', () => {
    expect(truncateAtSentence('', 5)).toBe('')
  })

  it('real overlong prose truncates to a complete sentence without 「…」', () => {
    const body = '第一段論述。'.repeat(120) // 720 字、每 6 字一句
    const out = truncateAtSentence(body, 600, 250) as string
    expect(out.length).toBeLessThanOrEqual(600)
    expect(out.length).toBeGreaterThanOrEqual(250)
    expect(out.endsWith('。')).toBe(true)
    expect(out).not.toContain('…')
  })
})

describe('splitSentences', () => {
  it('splits on Chinese enders keeping the delimiter attached', () => {
    expect(splitSentences('甲。乙！丙？')).toEqual(['甲。', '乙！', '丙？'])
  })
  it('keeps trailing text without an ender as a final chunk', () => {
    expect(splitSentences('甲。乙')).toEqual(['甲。', '乙'])
  })
  it('treats newline as a boundary', () => {
    expect(splitSentences('甲\n乙')).toEqual(['甲\n', '乙'])
  })
  it('returns empty array for empty string', () => {
    expect(splitSentences('')).toEqual([])
  })
})
