import type { ProviderCallParams, ProviderCallResult } from './types.js'
import process from 'node:process'

const DEFAULT_BASE_URL = 'https://api.openai.com/v1'

// .env.example 裡沒填的值會被人抄成 `KEY=`（空字串），Node --env-file 給的是 ''
// 不是 undefined，`??` 接不住——空字串會原樣被當成「有值」用掉。這裡統一用
// 「trim 後非空才算有值」取代 `??` 的裸判斷，兩個 resolve 函式共用。
function readNonEmptyEnv(key: string): string | undefined {
  const raw = process.env[key]
  if (raw === undefined)
    return undefined
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

// base URL 與 key 都給兩個名字：OPENAI_* 給只跑 OpenAI 的人、LLM_* 給自架／OpenRouter
// 這類「provider 名稱本身不是 openai」但走同一套相容 API 的人（先看 OPENAI_*、沒有才退回 LLM_*）。
function resolveBaseUrl(): string {
  return readNonEmptyEnv('OPENAI_BASE_URL') ?? readNonEmptyEnv('LLM_BASE_URL') ?? DEFAULT_BASE_URL
}

function resolveApiKey(): string {
  const key = readNonEmptyEnv('OPENAI_API_KEY') ?? readNonEmptyEnv('LLM_API_KEY')
  if (!key)
    throw new Error('openai provider: neither OPENAI_API_KEY nor LLM_API_KEY is set')
  return key
}

interface OpenAiUsage {
  prompt_tokens?: number
  completion_tokens?: number
  prompt_tokens_details?: { cached_tokens?: number }
}

interface OpenAiChatCompletion {
  choices?: Array<{ message?: { content?: string } }>
  usage?: OpenAiUsage
}

// OpenAI 相容 chat completions API：自架端點（vLLM、Ollama、LM Studio）與 OpenRouter
// 都吃這個形狀。走原生 fetch、不引 SDK（對齊 podcast-tts/gemini-tts-client.ts 的既有做法）。
export async function callOpenAI(p: ProviderCallParams & { maxTokens?: number }): Promise<ProviderCallResult> {
  const apiKey = resolveApiKey()
  const baseUrl = resolveBaseUrl()

  // 已知限制（2026-09-10、未實作退路）：這裡寫死 strict json_schema。官方 OpenAI 支援，
  // 但大量自架端點（Ollama、LM Studio、舊版 vLLM）與 OpenRouter 上多數開源 model 不支援
  // strict json_schema——會回 400，或忽略 schema 後吐非 JSON（下面 JSON.parse 會 throw
  // 「response content is not valid JSON」，訊息不會講清楚根因是端點不支援這個欄位）。
  // 目前沒有 json_object／無 schema 的退路。沒有真實端點可驗就不動這段：要加退路（例如
  // 偵測 400 後降級成 json_object 或整段拿掉 response_format 重試）得先找一個會踩雷的
  // 真實端點跑過，不能只憑讀 OpenAI/vLLM 文件猜。
  const body: Record<string, unknown> = {
    model: p.modelName,
    messages: [
      { role: 'system', content: p.systemPrompt },
      { role: 'user', content: p.userContent },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'response', schema: p.responseSchema, strict: true },
    },
  }
  if (p.maxTokens !== undefined)
    body.max_tokens = p.maxTokens

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), p.timeoutMs)
  let res: Response
  try {
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  }
  catch (err) {
    clearTimeout(timer)
    throw err
  }
  clearTimeout(timer)

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`openai provider: HTTP ${res.status} ${text.slice(0, 200)}`)
  }

  const json = await res.json() as OpenAiChatCompletion
  const content = json.choices?.[0]?.message?.content
  if (content === undefined)
    throw new Error('openai provider: no message content in response')

  let raw: unknown
  try {
    raw = JSON.parse(content)
  }
  catch {
    throw new Error('openai provider: response content is not valid JSON')
  }

  const usage = json.usage
  const tokensIn = usage?.prompt_tokens ?? 0
  const tokensOut = usage?.completion_tokens ?? 0
  const cachedReadTokens = usage?.prompt_tokens_details?.cached_tokens

  return {
    raw,
    tokensIn,
    tokensOut,
    ...(cachedReadTokens !== undefined ? { cachedReadTokens } : {}),
  }
}
