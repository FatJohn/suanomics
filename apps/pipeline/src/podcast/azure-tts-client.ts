import { Buffer } from 'node:buffer'

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

/**
 * Azure 計費字元數的上界：speak 與 voice 標籤不計，其餘標記、標點、空白照算，中文字算 2。
 * 非 ASCII 一律算 2 是刻意高估（全形標點官方未說算幾個），拿來守免費額度寧可多算。
 */
export function azureBillableChars(ssml: string): number {
  const billable = ssml.replace(/<\/?(?:speak|voice)\b[^>]*>/g, '')
  let count = 0
  for (const ch of billable)
    count += ch.charCodeAt(0) < 0x80 ? 1 : 2
  return count
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
  ssml: string
  region: string
  key: string
}

const defaultFetch: AzureFetch = async (url, init) => {
  // 一段最多約 3 分鐘音檔，120 秒內合成不完就當失敗，不讓 workflow 卡到逾時。
  const r = await fetch(url, { method: init.method, headers: init.headers, body: init.body, signal: AbortSignal.timeout(120_000) })
  return { ok: r.ok, status: r.status, arrayBuffer: () => r.arrayBuffer(), text: () => r.text() }
}

// 單次請求的音檔超過 10 分鐘會被 Azure 截斷，呼叫端要先切段。
export async function synthesizeAzure(opts: SynthesizeAzureOptions, fetchImpl: AzureFetch = defaultFetch): Promise<Buffer> {
  const res = await fetchImpl(azureTtsEndpoint(opts.region), {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': opts.key,
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': AZURE_OUTPUT_FORMAT,
      'User-Agent': 'suanomics-podcast-tts',
    },
    body: opts.ssml,
  })
  if (!res.ok)
    throw new Error(`Azure TTS HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const audio = Buffer.from(await res.arrayBuffer())
  if (audio.length === 0)
    throw new Error('Azure TTS 回 200 但音檔是空的')
  return audio
}
