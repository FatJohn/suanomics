import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import { buildRequestBody, DEFAULT_PODCAST_VOICE, DEFAULT_TTS_MODEL, parseResponse, ttsEndpoint } from './gemini-tts-client.js'

describe('buildRequestBody', () => {
  it('wraps text in contents.parts and sets AUDIO modality + voice', () => {
    const body = buildRequestBody('hello', 'Kore')
    expect(body).toEqual({
      contents: [{ parts: [{ text: 'hello' }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Kore' },
          },
        },
      },
    })
  })

  it('preserves multi-line text including \\n\\n', () => {
    const body = buildRequestBody('line 1\n\nline 2', 'Kore')
    expect(body.contents[0]?.parts[0]?.text).toBe('line 1\n\nline 2')
  })
})

describe('parseResponse', () => {
  it('extracts PCM buffer + sample rate from inlineData', () => {
    const pcmHex = 'aabbccdd'
    const json = {
      candidates: [{
        content: {
          parts: [{
            inlineData: {
              mimeType: 'audio/L16;codec=pcm;rate=24000',
              data: Buffer.from(pcmHex, 'hex').toString('base64'),
            },
          }],
        },
      }],
    }
    const { pcm, sampleRate } = parseResponse(json)
    expect(pcm.equals(Buffer.from(pcmHex, 'hex'))).toBe(true)
    expect(sampleRate).toBe(24000)
  })

  it('handles snake_case inline_data (alternate API casing)', () => {
    const json = {
      candidates: [{
        content: {
          parts: [{
            inline_data: {
              mime_type: 'audio/L16;codec=pcm;rate=24000',
              data: Buffer.from('00').toString('base64'),
            },
          }],
        },
      }],
    }
    expect(() => parseResponse(json)).not.toThrow()
    expect(parseResponse(json).sampleRate).toBe(24000)
  })

  it('defaults sampleRate to 24000 if mime missing rate', () => {
    const json = {
      candidates: [{
        content: {
          parts: [{ inlineData: { mimeType: 'audio/L16', data: 'AA==' } }],
        },
      }],
    }
    expect(parseResponse(json).sampleRate).toBe(24000)
  })

  it('throws when no candidates / no inlineData', () => {
    expect(() => parseResponse({ candidates: [] })).toThrow(/no/i)
    expect(() => parseResponse({ candidates: [{ content: { parts: [{}] } }] })).toThrow(/no/i)
  })
})

describe('dEFAULT_PODCAST_VOICE', () => {
  it('預設為溫暖成熟男聲 Algieba', () => {
    expect(DEFAULT_PODCAST_VOICE).toBe('Algieba')
  })
})

describe('tTS model / endpoint', () => {
  it('預設模型為 gemini-3.1-flash-tts-preview', () => {
    expect(DEFAULT_TTS_MODEL).toBe('gemini-3.1-flash-tts-preview')
  })

  it('由 model id 組出 generateContent endpoint', () => {
    expect(ttsEndpoint('gemini-3.1-flash-tts-preview')).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-tts-preview:generateContent',
    )
  })
})
