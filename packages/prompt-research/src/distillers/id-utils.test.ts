import { describe, expect, it } from 'vitest'
import { hashFrameId, hashRedFlagId, hashVocabId } from './id-utils.js'

describe('id-utils', () => {
  it('hashFrameId should return 8-char hex from name + whenToApply', () => {
    const id = hashFrameId('5-phase scoping', '央行政策改變時')
    expect(id).toMatch(/^[0-9a-f]{8}$/)
  })

  it('hashFrameId should be stable across calls', () => {
    expect(hashFrameId('foo', 'bar')).toBe(hashFrameId('foo', 'bar'))
  })

  it('hashFrameId should differ when inputs differ', () => {
    expect(hashFrameId('foo', 'bar')).not.toBe(hashFrameId('foo', 'baz'))
  })

  it('hashVocabId should hash preferred only', () => {
    const id = hashVocabId('配置比重提升')
    expect(id).toMatch(/^[0-9a-f]{8}$/)
  })

  it('hashRedFlagId should hash rule only', () => {
    const id = hashRedFlagId('個股 ticker + 方向性動詞 — 禁')
    expect(id).toMatch(/^[0-9a-f]{8}$/)
  })

  it('hashFrameId should normalize whitespace', () => {
    expect(hashFrameId('foo bar', 'baz')).toBe(hashFrameId(' foo  bar ', 'baz'))
  })
})
