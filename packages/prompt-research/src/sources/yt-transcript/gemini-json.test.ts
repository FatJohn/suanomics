import { describe, expect, it } from 'vitest'
import { extractJson } from './gemini-json.js'

describe('extractJson', () => {
  it('shouldParseVanillaJsonObject', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 })
  })

  it('shouldParseVanillaJsonArray', () => {
    expect(extractJson('[1,2,3]')).toEqual([1, 2, 3])
  })

  it('shouldStripMarkdownCodeFenceWithJsonTag', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 })
  })

  it('shouldStripMarkdownCodeFenceWithoutLanguageTag', () => {
    expect(extractJson('```\n{"a":1}\n```')).toEqual({ a: 1 })
  })

  it('shouldExtractFirstBalancedObjectWhenExtraTextAfter', () => {
    expect(extractJson('{"a":1}\n\nAnother sentence of prose')).toEqual({ a: 1 })
  })

  it('shouldExtractFirstBalancedObjectWhenPreamble', () => {
    expect(extractJson('Here is the JSON: {"a":1}')).toEqual({ a: 1 })
  })

  it('shouldRespectBracesInsideStrings', () => {
    expect(extractJson('{"msg":"a}b","x":2}')).toEqual({ msg: 'a}b', x: 2 })
  })

  it('shouldRespectEscapedQuotesInsideStrings', () => {
    expect(extractJson('{"s":"a\\"b"}')).toEqual({ s: 'a"b' })
  })

  it('shouldThrowWhenNoJsonFound', () => {
    expect(() => extractJson('no json at all')).toThrow()
  })

  it('shouldHandleNestedObjects', () => {
    expect(extractJson('{"a":{"b":{"c":1}}}')).toEqual({ a: { b: { c: 1 } } })
  })
})
