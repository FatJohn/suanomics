import { describe, expect, it } from 'vitest'
import { splitSentences, stripViolatingProseBy } from './compliance-strip.js'
import { checkCompliance } from './compliance.js'

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

describe('stripViolatingProseBy', () => {
  it('可傳入自訂判定，讓呼叫端先正規化再檢查', () => {
    const isViolating = (t: string): boolean => checkCompliance(t.replace(/\*/g, '')) !== null
    expect(stripViolatingProseBy('建議**買**進。油價上漲。', isViolating)).toBe('油價上漲。')
  })
})
