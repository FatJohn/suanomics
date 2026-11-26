import type { AzureFetch } from './azure-tts-client.js'
import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import { azureBillableChars, azureTtsEndpoint, buildAzureSsml, DEFAULT_AZURE_RATE, DEFAULT_AZURE_VOICE, synthesizeAzure } from './azure-tts-client.js'

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

describe('azureBillableChars', () => {
  it('不計 speak 與 voice 標籤，其餘標記照算；非 ASCII 字元一律算 2', () => {
    const ssml = buildAzureSsml({ text: '台積電 3%，', voice: 'zh-TW-YunJheNeural', rate: '1.1' })
    // <prosody rate='1.1'> 20 + </prosody> 10 + 「台積電」3x2 + 「 3%」3 + 「，」2
    expect(azureBillableChars(ssml)).toBe(20 + 10 + 6 + 3 + 2)
  })

  it('跳脫後的實體照字元數算', () => {
    const ssml = buildAzureSsml({ text: 'A&B', voice: 'v', rate: '1' })
    expect(azureBillableChars(ssml)).toBe(`<prosody rate='1'>`.length + `</prosody>`.length + 'A&amp;B'.length)
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
      arrayBuffer: async () => new Uint8Array(audio).buffer,
      text: async () => 'err-body',
    }
  }
  return { fetch, calls }
}

describe('synthesizeAzure', () => {
  const opts = { ssml: buildAzureSsml({ text: '哈囉', voice: DEFAULT_AZURE_VOICE, rate: DEFAULT_AZURE_RATE }), region: 'australiaeast', key: 'SECRET' }

  it('pOSTs SSML with auth + output-format headers and returns mp3 Buffer', async () => {
    const { fetch, calls } = recordingFetch(200, new Uint8Array([0xFF, 0xFB, 0x12]))
    const buf = await synthesizeAzure(opts, fetch)
    expect(buf.equals(Buffer.from([0xFF, 0xFB, 0x12]))).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      url: 'https://australiaeast.tts.speech.microsoft.com/cognitiveservices/v1',
      headers: {
        'Ocp-Apim-Subscription-Key': 'SECRET',
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
      },
      body: opts.ssml,
    })
  })

  it('throws on non-ok HTTP status', async () => {
    const { fetch } = recordingFetch(401, new Uint8Array())
    await expect(synthesizeAzure(opts, fetch)).rejects.toThrow(/401/)
  })

  it('回 200 但內容為空時丟錯，不把空檔當成音檔', async () => {
    const { fetch } = recordingFetch(200, new Uint8Array())
    await expect(synthesizeAzure(opts, fetch)).rejects.toThrow(/空/)
  })
})
