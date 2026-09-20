import type { ProviderCallParams, ProviderCallResult } from './types.js'
import process from 'node:process'
import Anthropic from '@anthropic-ai/sdk'

function createClient(apiKey: string): Anthropic {
  // 在 vitest mock 環境下、vi.fn(() => ...) 是 arrow function 不能 new（對齊 gemini.ts）
  // 用 try/catch fallback 讓 production new 和 test call-without-new 都能用
  const Ctor = Anthropic as unknown as {
    new (opts: { apiKey: string }): Anthropic
    (opts: { apiKey: string }): Anthropic
  }
  try {
    return new Ctor({ apiKey })
  }
  catch (err) {
    if (err instanceof TypeError && err.message.includes('is not a constructor'))
      return Ctor({ apiKey })
    throw err
  }
}

let _client: Anthropic | null = null
function client(): Anthropic {
  if (_client)
    return _client
  const key = process.env.ANTHROPIC_API_KEY
  if (!key)
    throw new Error('ANTHROPIC_API_KEY not set')
  _client = createClient(key)
  return _client
}

// Claude 無 Gemini 式 responseSchema、structured output 走 forced tool-use（業界標準做法）：
// 宣告單一 emit_result tool、input_schema = 傳入的 JSON schema、tool_choice 強制走它。
export async function callAnthropic(p: ProviderCallParams & { maxTokens: number }): Promise<ProviderCallResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), p.timeoutMs)
  try {
    const res = await client().messages.create({
      model: p.modelName,
      max_tokens: p.maxTokens,
      // system prompt 標 cache_control：analyst 一輪重複送同一份、第 2 次起走 cache read（0.1x）。
      system: [{ type: 'text', text: p.systemPrompt, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: p.userContent }],
      tools: [{
        name: 'emit_result',
        description: 'Return the structured analysis result.',
        input_schema: p.responseSchema as Anthropic.Tool['input_schema'],
      }],
      tool_choice: { type: 'tool', name: 'emit_result' },
    }, { signal: controller.signal })
    clearTimeout(timer)

    const block = res.content.find(b => b.type === 'tool_use')
    if (!block || block.type !== 'tool_use')
      throw new Error('anthropic provider: no tool_use block in response')
    return {
      raw: block.input,
      tokensIn: res.usage.input_tokens,
      tokensOut: res.usage.output_tokens,
      cachedReadTokens: res.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: res.usage.cache_creation_input_tokens ?? 0,
    }
  }
  catch (err) {
    clearTimeout(timer)
    throw err
  }
}
