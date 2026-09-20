import type { ProviderCallParams, ProviderCallResult } from './types.js'
import process from 'node:process'
import { GoogleGenAI } from '@google/genai'

// re-export：既有 import { ProviderCallParams } from './gemini.js' 不破
export type { ProviderCallParams, ProviderCallResult } from './types.js'

function createClient(apiKey: string): GoogleGenAI {
  // 在 vitest mock 環境下、vi.fn().mockImplementation(() => ...) 是 arrow function 不能 new
  // 用 try/catch fallback 讓 production new 和 test call-without-new 都能用
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

let _client: GoogleGenAI | null = null
function client(): GoogleGenAI {
  if (_client)
    return _client
  const key = process.env.GEMINI_API_KEY
  if (!key)
    throw new Error('GEMINI_API_KEY not set')
  _client = createClient(key)
  return _client
}

export async function callGemini(p: ProviderCallParams): Promise<ProviderCallResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), p.timeoutMs)
  try {
    const res = await client().models.generateContent({
      model: p.modelName,
      contents: [{ role: 'user', parts: [{ text: p.userContent }] }],
      config: {
        systemInstruction: p.systemPrompt,
        responseMimeType: 'application/json',
        responseSchema: p.responseSchema,
        abortSignal: controller.signal,
      },
    })
    clearTimeout(timer)

    const text = (res as { text?: string }).text ?? ''
    const usage = (res as {
      usageMetadata?: { promptTokenCount?: number, candidatesTokenCount?: number, cachedContentTokenCount?: number }
    }).usageMetadata
    const tokensIn = usage?.promptTokenCount ?? 0
    const tokensOut = usage?.candidatesTokenCount ?? 0
    const cachedReadTokens = usage?.cachedContentTokenCount ?? 0 // 隱式快取命中（promptTokenCount 已含、成本帳相減）
    return { raw: JSON.parse(text), tokensIn, tokensOut, cachedReadTokens }
  }
  catch (err) {
    clearTimeout(timer)
    throw err
  }
}
