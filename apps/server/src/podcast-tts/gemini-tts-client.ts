import { Buffer } from 'node:buffer'
import process from 'node:process'

// 預設 TTS 模型。3.1 比 2.5-flash 的 per-call 語音一致性 / pacing 較好（仍有殘留漂移、
// 評估替代服務中）。可用 PODCAST_TTS_MODEL env 或 synthesize 的 model 參數覆寫、不需改碼。
export const DEFAULT_TTS_MODEL = 'gemini-3.1-flash-tts-preview'

export function ttsEndpoint(model: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
}

export const DEFAULT_PODCAST_VOICE = 'Algieba'

export interface GeminiTTSRequestBody {
  contents: Array<{ parts: Array<{ text: string }> }>
  generationConfig: {
    responseModalities: ['AUDIO']
    speechConfig: {
      voiceConfig: { prebuiltVoiceConfig: { voiceName: string } }
    }
  }
}

export function buildRequestBody(text: string, voice: string): GeminiTTSRequestBody {
  return {
    contents: [{ parts: [{ text }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: voice },
        },
      },
    },
  }
}

export interface ParsedTTSResponse {
  pcm: Buffer
  sampleRate: number
}

export function parseResponse(json: unknown): ParsedTTSResponse {
  const candidates = (json as { candidates?: unknown[] })?.candidates ?? []
  const part = (candidates[0] as { content?: { parts?: unknown[] } })?.content?.parts?.[0] as
    | {
      inlineData?: { mimeType?: string, data?: string }
      inline_data?: { mime_type?: string, data?: string }
    }
    | undefined
  const inline = part?.inlineData ?? part?.inline_data
  const data = inline?.data
  if (!data)
    throw new Error('Gemini TTS response: no inlineData')
  const mime
    = (inline as { mimeType?: string })?.mimeType
      ?? (inline as { mime_type?: string })?.mime_type
      ?? ''
  const rateMatch = mime.match(/rate=(\d+)/)
  return {
    pcm: Buffer.from(data, 'base64'),
    sampleRate: rateMatch ? Number(rateMatch[1]) : 24000,
  }
}

export interface SynthesizeOptions {
  text: string
  voice?: string
  apiKey?: string
  model?: string
}

export async function synthesize(opts: SynthesizeOptions): Promise<ParsedTTSResponse> {
  const apiKey = opts.apiKey ?? process.env.GEMINI_API_KEY
  if (!apiKey)
    throw new Error('GEMINI_API_KEY not set')
  const voice = opts.voice ?? DEFAULT_PODCAST_VOICE
  const model = opts.model ?? process.env.PODCAST_TTS_MODEL ?? DEFAULT_TTS_MODEL
  const body = buildRequestBody(opts.text, voice)
  const res = await fetch(`${ttsEndpoint(model)}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`Gemini TTS HTTP ${res.status}: ${txt.slice(0, 500)}`)
  }
  return parseResponse(await res.json())
}
