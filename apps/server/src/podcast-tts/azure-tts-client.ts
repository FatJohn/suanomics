import { Buffer } from 'node:buffer'
import process from 'node:process'

// Azure Speech 台灣男聲（曉臻/曉雨為女聲、雲哲為唯一台灣男聲）。
export const DEFAULT_AZURE_VOICE = 'zh-TW-YunJheNeural'
// YunJhe 預設偏慢、1.1 較順（user 實聽確認）。
export const DEFAULT_AZURE_RATE = '1.1'
// 24kHz mono mp3：語音夠用、檔案小（mono 置中送雙喇叭）。
export const AZURE_OUTPUT_FORMAT = 'audio-24khz-48kbitrate-mono-mp3'

export function azureTtsEndpoint(region: string): string {
  return `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export function buildAzureSsml(opts: { text: string, voice: string, rate: string }): string {
  return `<speak version='1.0' xml:lang='zh-TW'><voice name='${opts.voice}'><prosody rate='${opts.rate}'>${escapeXml(opts.text)}</prosody></voice></speak>`
}

// 注入式 fetch：只暴露用得到的欄位、單測可塞假實作。
export interface AzureResponse {
  ok: boolean
  status: number
  arrayBuffer: () => Promise<ArrayBuffer>
  text: () => Promise<string>
}
export type AzureFetch = (
  url: string,
  init: { method: string, headers: Record<string, string>, body: string },
) => Promise<AzureResponse>

export interface SynthesizeAzureOptions {
  text: string
  voice?: string
  rate?: string
  region?: string
  key?: string
}

// 整集一次請求 → 回 mp3 bytes。Azure neural 穩定、無 Gemini 那種 per-call 漂移、
// 故不需切段。voice/rate/region/key 走 opts ?? env ?? default。
export async function synthesizeAzure(opts: SynthesizeAzureOptions, fetchImpl?: AzureFetch): Promise<Buffer> {
  const key = opts.key ?? process.env.AZURE_SPEECH_KEY
  const region = opts.region ?? process.env.AZURE_SPEECH_REGION
  if (!key || !region)
    throw new Error('synthesizeAzure: AZURE_SPEECH_KEY / AZURE_SPEECH_REGION not set')
  const voice = opts.voice ?? process.env.AZURE_SPEECH_VOICE ?? DEFAULT_AZURE_VOICE
  const rate = opts.rate ?? process.env.AZURE_SPEECH_RATE ?? DEFAULT_AZURE_RATE

  const doFetch: AzureFetch = fetchImpl ?? (async (url, init) => {
    const r = await fetch(url, { method: init.method, headers: init.headers, body: init.body })
    return { ok: r.ok, status: r.status, arrayBuffer: () => r.arrayBuffer(), text: () => r.text() }
  })

  const res = await doFetch(azureTtsEndpoint(region), {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': key,
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': AZURE_OUTPUT_FORMAT,
      'User-Agent': 'suanomics-podcast-tts',
    },
    body: buildAzureSsml({ text: opts.text, voice, rate }),
  })
  if (!res.ok)
    throw new Error(`Azure TTS HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
  return Buffer.from(await res.arrayBuffer())
}
