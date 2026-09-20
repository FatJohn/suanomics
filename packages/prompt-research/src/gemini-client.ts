import process from 'node:process'
import { GoogleGenAI } from '@google/genai'

/**
 * ★ Gemini 專屬、換 provider 換不掉。
 *
 * `packages/prompt-research`（Transcript Tool，第二個產品）不能 import
 * `apps/server/src/agents/providers/`——依賴方向是 server → prompt-research，反過來會
 * 成環。要接上 `apps/server` 那套 provider-neutral 抽象，等於把整個抽象層搬進共用
 * package——那是一次架構重寫。判準是「不重寫還能動的東西」，所以這裡的決定是
 * 明確標成 Gemini-only、留一個清楚的換 provider 入口，而不是假裝它可攜。
 *
 * 同一份理由適用於本檔與另外三個直接呼叫 `GoogleGenAI` 的檔案：
 * `sources/yt-transcript/segmenter.ts`、`sources/yt-transcript/lens-extractors.ts`、
 * `sources/yt-transcript/consolidator.ts`（各自只留一行指標指回這裡，不複製整段說明，
 * 避免四份各自過期）。清單與守門測試見 `apps/server/tools/ci/gemini-only-paths.ts`。
 */

// Transcript Tool 專屬 env（見 sources/yt-transcript/segmenter.ts 的說明）
const DEFAULT_MODEL = process.env.TRANSCRIPT_TOOL_MODEL ?? 'gemini-3-flash-preview'
const DEFAULT_TIMEOUT_MS = 45_000
const DEFAULT_MAX_ATTEMPTS = 3

export interface CallGeminiParams {
  systemPrompt: string
  userContent: string
  responseSchema?: unknown
  model?: string
  timeoutMs?: number
  maxAttempts?: number
}

function createClient(apiKey: string) {
  const GenAI = GoogleGenAI as unknown as {
    new (opts: { apiKey: string }): InstanceType<typeof GoogleGenAI>
    (opts: { apiKey: string }): InstanceType<typeof GoogleGenAI>
  }
  try {
    return new GenAI({ apiKey })
  }
  catch (err) {
    if (err instanceof TypeError && err.message.includes('is not a constructor'))
      return GenAI({ apiKey })
    throw err
  }
}

export async function callGemini(params: CallGeminiParams): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey)
    throw new Error('GEMINI_API_KEY not set')

  const model = params.model ?? DEFAULT_MODEL
  const timeoutMs = params.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxAttempts = params.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  const ai = createClient(apiKey)

  let lastErr: unknown
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), timeoutMs)
    try {
      const res = await ai.models.generateContent({
        model,
        contents: params.userContent,
        config: {
          systemInstruction: params.systemPrompt,
          ...(params.responseSchema
            ? { responseMimeType: 'application/json', responseSchema: params.responseSchema }
            : {}),
          abortSignal: ctl.signal,
        },
      })
      const text = res.text
      if (!text)
        throw new Error('empty response')
      return text
    }
    catch (err) {
      lastErr = err
      if (err instanceof Error && err.name === 'AbortError')
        throw err
      if (attempt === maxAttempts - 1)
        throw err
      const backoffMs = 500 * 2 ** attempt
      await new Promise(resolve => setTimeout(resolve, backoffMs))
    }
    finally {
      clearTimeout(timer)
    }
  }
  throw lastErr
}
