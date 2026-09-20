import type { TranscribeAudio, TranscribeInput } from './types.js'
import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'

describe('transcribeInput shape', () => {
  it('accepts canonical input', () => {
    const input: TranscribeInput = {
      audio: Buffer.from([1, 2, 3]),
      mimeType: 'audio/mpeg',
      episodeId: 'ep1',
    }
    expect(input.audio.length).toBe(3)
    expect(input.mimeType).toBe('audio/mpeg')
  })

  it('allows optional hintLanguage', () => {
    const input: TranscribeInput = {
      audio: Buffer.from([]),
      mimeType: 'audio/mp4',
      episodeId: 'ep2',
      hintLanguage: 'zh-TW',
    }
    expect(input.hintLanguage).toBe('zh-TW')
  })
})

describe('transcribeAudio type', () => {
  it('typechecks as (input) => Promise<string>', async () => {
    const stubProvider: TranscribeAudio = async () => 'transcript-stub'
    const out = await stubProvider({
      audio: Buffer.from([0]),
      mimeType: 'audio/mpeg',
      episodeId: 'ep',
    })
    expect(out).toBe('transcript-stub')
  })
})
