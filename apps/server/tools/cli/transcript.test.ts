import { describe, expect, it } from 'vitest'
import { parseTranscriptArgs } from './transcript.js'

describe('parseTranscriptArgs', () => {
  it('shouldReturnErrorWhenNoArgs', () => {
    const r = parseTranscriptArgs([])
    expect('error' in r && r.error.length > 0).toBe(true)
  })

  it('shouldReturnErrorWhenBlankArg', () => {
    expect('error' in parseTranscriptArgs(['   '])).toBe(true)
  })

  it('shouldReturnTrimmedUrlWhenGiven', () => {
    const r = parseTranscriptArgs(['  https://youtu.be/abcdefghijk  '])
    expect(r).toEqual({ url: 'https://youtu.be/abcdefghijk' })
  })

  it('shouldIgnoreExtraArgs', () => {
    const r = parseTranscriptArgs(['https://youtu.be/abcdefghijk', 'extra'])
    expect(r).toEqual({ url: 'https://youtu.be/abcdefghijk' })
  })
})
