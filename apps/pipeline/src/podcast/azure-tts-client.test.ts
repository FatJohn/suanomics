import type { AzureFetch } from './azure-tts-client.js'
import { Buffer } from 'node:buffer'
import { describe, expect, it, vi } from 'vitest'
import { azureTtsEndpoint, buildAzureSsml, DEFAULT_AZURE_RATE, DEFAULT_AZURE_VOICE, synthesizeAzure } from './azure-tts-client.js'

describe('buildAzureSsml', () => {
  it('wraps text in SSML with zh-TW lang, voice name and prosody rate', () => {
    const ssml = buildAzureSsml({ text: '你好', voice: 'zh-TW-YunJheNeural', rate: '1.1' })
    expect(ssml).toContain(`xml:lang='zh-TW'`)
    expect(ssml).toContain(`name='zh-TW-YunJheNeural'`)
    expect(ssml).toContain(`rate='1.1'`)
    expect(ssml).toContain('你好')
  })

  it('escapes XML-special characters in text', () => {
    const ssml = buildAzureSsml({ text: 'A&B <c> "d" \'e\'', voice: 'v', rate: '1.0' })
    expect(ssml).toContain('A&amp;B &lt;c&gt; &quot;d&quot; &apos;e&apos;')
    expect(ssml).not.toMatch(/<c>/)
  })
})

describe('azureTtsEndpoint', () => {
  it('builds region-specific cognitiveservices v1 endpoint', () => {
    expect(azureTtsEndpoint('australiaeast')).toBe('https://australiaeast.tts.speech.microsoft.com/cognitiveservices/v1')
  })
})

describe('defaults', () => {
  it('default voice is zh-TW-YunJheNeural, default rate 1.1', () => {
    expect(DEFAULT_AZURE_VOICE).toBe('zh-TW-YunJheNeural')
    expect(DEFAULT_AZURE_RATE).toBe('1.1')
  })
})

interface Call { url: string, headers: Record<string, string>, body: string }
function recordingFetch(status: number, audio: Uint8Array): { fetch: AzureFetch, calls: Call[] } {
  const calls: Call[] = []
  const fetch: AzureFetch = async (url, init) => {
    calls.push({ url, headers: init.headers, body: init.body })
    return {
      ok: status >= 200 && status < 300,
      status,
      arrayBuffer: async () => audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength),
      text: async () => 'err-body',
    }
  }
  return { fetch, calls }
}

describe('synthesizeAzure', () => {
  const opts = { text: '哈囉', voice: 'zh-TW-YunJheNeural', rate: '1.1', region: 'australiaeast', key: 'SECRET' }

  it('pOSTs SSML with auth + output-format headers and returns mp3 Buffer', async () => {
    const { fetch, calls } = recordingFetch(200, new Uint8Array([0xFF, 0xFB, 0x12]))
    const buf = await synthesizeAzure(opts, fetch)
    expect(buf.equals(Buffer.from([0xFF, 0xFB, 0x12]))).toBe(true)
    expect(calls).toHaveLength(1)
    // eslint-disable-next-line ts/no-non-null-assertion -- toHaveLength(1) guarantees calls[0]
    const c = calls[0]!
    expect(c.url).toBe('https://australiaeast.tts.speech.microsoft.com/cognitiveservices/v1')
    expect(c.headers['Ocp-Apim-Subscription-Key']).toBe('SECRET')
    expect(c.headers['Content-Type']).toBe('application/ssml+xml')
    expect(c.headers['X-Microsoft-OutputFormat']).toContain('mp3')
    expect(c.body).toContain(`name='zh-TW-YunJheNeural'`)
  })

  it('throws on non-ok HTTP status', async () => {
    const { fetch } = recordingFetch(401, new Uint8Array())
    await expect(synthesizeAzure(opts, fetch)).rejects.toThrow(/401/)
  })

  it('throws when key or region missing', async () => {
    // 鎖空 env、確保不被 env fallback 影響（vitest 會載 .env 進 process.env）
    vi.stubEnv('AZURE_SPEECH_KEY', '')
    vi.stubEnv('AZURE_SPEECH_REGION', '')
    const { fetch } = recordingFetch(200, new Uint8Array([1]))
    await expect(synthesizeAzure({ text: 'x' }, fetch)).rejects.toThrow(/AZURE_SPEECH_KEY/)
    vi.unstubAllEnvs()
  })
})
