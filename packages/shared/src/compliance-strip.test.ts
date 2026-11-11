import { describe, expect, it } from 'vitest'
import { splitSentences } from './compliance-strip.js'

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
