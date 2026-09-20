import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { callOpenAI } from './openai.js'

function jsonResponse(body: unknown, init?: { status?: number }): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('callOpenAI', () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test-key'
    delete process.env.LLM_API_KEY
    delete process.env.OPENAI_BASE_URL
    delete process.env.LLM_BASE_URL
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.OPENAI_API_KEY
  })

  it('缺 OPENAI_API_KEY 與 LLM_API_KEY 都沒設 → throw', async () => {
    delete process.env.OPENAI_API_KEY
    await expect(callOpenAI({
      modelName: 'gpt-4o-mini',
      systemPrompt: 's',
      userContent: 'u',
      responseSchema: {},
      timeoutMs: 5000,
    })).rejects.toThrow(/OPENAI_API_KEY|LLM_API_KEY/)
  })

  it('用 LLM_API_KEY 可以取代 OPENAI_API_KEY', async () => {
    delete process.env.OPENAI_API_KEY
    process.env.LLM_API_KEY = 'llm-key'
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      choices: [{ message: { content: '{"ok":true}' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }))
    vi.stubGlobal('fetch', fetchMock)
    const res = await callOpenAI({
      modelName: 'gpt-4o-mini',
      systemPrompt: 's',
      userContent: 'u',
      responseSchema: {},
      timeoutMs: 5000,
    })
    expect(res.raw).toEqual({ ok: true })
    delete process.env.LLM_API_KEY
  })

  it('request body 形狀正確：model / messages(system+user) / response_format json_schema / max_tokens', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      choices: [{ message: { content: '{"headline":"x"}' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const schema = { type: 'object', properties: { headline: { type: 'string' } } }
    await callOpenAI({
      modelName: 'gpt-4o-mini',
      systemPrompt: 'sys',
      userContent: 'user',
      responseSchema: schema,
      timeoutMs: 5000,
      maxTokens: 2048,
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.openai.com/v1/chat/completions')
    expect(opts.headers).toMatchObject({ 'authorization': 'Bearer test-key', 'content-type': 'application/json' })
    const body = JSON.parse(opts.body as string)
    expect(body.model).toBe('gpt-4o-mini')
    expect(body.messages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'user' },
    ])
    expect(body.response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'response', schema, strict: true },
    })
    expect(body.max_tokens).toBe(2048)
  })

  it('沒帶 maxTokens 時不送 max_tokens', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      choices: [{ message: { content: '{}' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }))
    vi.stubGlobal('fetch', fetchMock)
    await callOpenAI({ modelName: 'm', systemPrompt: 's', userContent: 'u', responseSchema: {}, timeoutMs: 5000 })
    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(opts.body as string)
    expect(body.max_tokens).toBeUndefined()
  })

  it('用 OPENAI_BASE_URL 可覆寫 base URL（自架與 OpenRouter）', async () => {
    process.env.OPENAI_BASE_URL = 'https://my-vllm.internal/v1'
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      choices: [{ message: { content: '{}' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }))
    vi.stubGlobal('fetch', fetchMock)
    await callOpenAI({ modelName: 'm', systemPrompt: 's', userContent: 'u', responseSchema: {}, timeoutMs: 5000 })
    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toBe('https://my-vllm.internal/v1/chat/completions')
    delete process.env.OPENAI_BASE_URL
  })

  it('沒有 OPENAI_BASE_URL 時才退回 LLM_BASE_URL', async () => {
    process.env.LLM_BASE_URL = 'https://my-openrouter.internal/v1'
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      choices: [{ message: { content: '{}' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }))
    vi.stubGlobal('fetch', fetchMock)
    await callOpenAI({ modelName: 'm', systemPrompt: 's', userContent: 'u', responseSchema: {}, timeoutMs: 5000 })
    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toBe('https://my-openrouter.internal/v1/chat/completions')
    delete process.env.LLM_BASE_URL
  })

  it('用 OPENAI_BASE_URL 與 LLM_BASE_URL 都設時，OPENAI_BASE_URL 優先（驗優先序、不是只驗其中一個存在即可）', async () => {
    process.env.OPENAI_BASE_URL = 'https://openai-wins.internal/v1'
    process.env.LLM_BASE_URL = 'https://should-not-be-used.internal/v1'
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      choices: [{ message: { content: '{}' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }))
    vi.stubGlobal('fetch', fetchMock)
    await callOpenAI({ modelName: 'm', systemPrompt: 's', userContent: 'u', responseSchema: {}, timeoutMs: 5000 })
    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toBe('https://openai-wins.internal/v1/chat/completions')
    delete process.env.OPENAI_BASE_URL
    delete process.env.LLM_BASE_URL
  })

  it('用 OPENAI_BASE_URL 是空字串時退回 LLM_BASE_URL（.env 裡沒填的值會是空字串、不是 undefined）', async () => {
    process.env.OPENAI_BASE_URL = ''
    process.env.LLM_BASE_URL = 'https://my-openrouter.internal/v1'
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      choices: [{ message: { content: '{}' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }))
    vi.stubGlobal('fetch', fetchMock)
    await callOpenAI({ modelName: 'm', systemPrompt: 's', userContent: 'u', responseSchema: {}, timeoutMs: 5000 })
    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toBe('https://my-openrouter.internal/v1/chat/completions')
    delete process.env.OPENAI_BASE_URL
    delete process.env.LLM_BASE_URL
  })

  it('用 OPENAI_BASE_URL 與 LLM_BASE_URL 都是空字串時退回預設值', async () => {
    process.env.OPENAI_BASE_URL = ''
    process.env.LLM_BASE_URL = ''
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      choices: [{ message: { content: '{}' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }))
    vi.stubGlobal('fetch', fetchMock)
    await callOpenAI({ modelName: 'm', systemPrompt: 's', userContent: 'u', responseSchema: {}, timeoutMs: 5000 })
    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toBe('https://api.openai.com/v1/chat/completions')
    delete process.env.OPENAI_BASE_URL
    delete process.env.LLM_BASE_URL
  })

  it('用 OPENAI_API_KEY 與 LLM_API_KEY 都設時，OPENAI_API_KEY 優先（驗優先序、不是只驗其中一個存在即可）', async () => {
    process.env.OPENAI_API_KEY = 'openai-wins'
    process.env.LLM_API_KEY = 'should-not-be-used'
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      choices: [{ message: { content: '{}' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }))
    vi.stubGlobal('fetch', fetchMock)
    await callOpenAI({ modelName: 'm', systemPrompt: 's', userContent: 'u', responseSchema: {}, timeoutMs: 5000 })
    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect((opts.headers as Record<string, string>).authorization).toBe('Bearer openai-wins')
    delete process.env.LLM_API_KEY
  })

  it('用 OPENAI_API_KEY 是空字串、LLM_API_KEY 有值時拿到 LLM_API_KEY、不 throw', async () => {
    process.env.OPENAI_API_KEY = ''
    process.env.LLM_API_KEY = 'llm-key'
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      choices: [{ message: { content: '{"ok":true}' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }))
    vi.stubGlobal('fetch', fetchMock)
    const res = await callOpenAI({
      modelName: 'gpt-4o-mini',
      systemPrompt: 's',
      userContent: 'u',
      responseSchema: {},
      timeoutMs: 5000,
    })
    expect(res.raw).toEqual({ ok: true })
    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect((opts.headers as Record<string, string>).authorization).toBe('Bearer llm-key')
    delete process.env.LLM_API_KEY
  })

  it('非 2xx → throw，訊息帶 status 與 body 前 200 字', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'bad request payload' }, { status: 400 })))
    await expect(callOpenAI({
      modelName: 'm',
      systemPrompt: 's',
      userContent: 'u',
      responseSchema: {},
      timeoutMs: 5000,
    })).rejects.toThrow(/400/)
  })

  it('content 不是合法 JSON → throw', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      choices: [{ message: { content: 'not json' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    })))
    await expect(callOpenAI({
      modelName: 'm',
      systemPrompt: 's',
      userContent: 'u',
      responseSchema: {},
      timeoutMs: 5000,
    })).rejects.toThrow(/not valid JSON/)
  })

  it('usage 欄位整個缺失時不炸、token 數當 0', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      choices: [{ message: { content: '{"ok":1}' } }],
    })))
    const res = await callOpenAI({
      modelName: 'm',
      systemPrompt: 's',
      userContent: 'u',
      responseSchema: {},
      timeoutMs: 5000,
    })
    expect(res.tokensIn).toBe(0)
    expect(res.tokensOut).toBe(0)
    expect(res.cachedReadTokens).toBeUndefined()
  })

  it('usage.prompt_tokens_details.cached_tokens 有值時填進 cachedReadTokens', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      choices: [{ message: { content: '{"ok":1}' } }],
      usage: { prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 80 } },
    })))
    const res = await callOpenAI({
      modelName: 'm',
      systemPrompt: 's',
      userContent: 'u',
      responseSchema: {},
      timeoutMs: 5000,
    })
    expect(res.cachedReadTokens).toBe(80)
  })

  it('逾時會 throw 出可辨識的錯誤（AbortError）', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, opts: RequestInit) => new Promise((_resolve, reject) => {
      opts.signal?.addEventListener('abort', () => {
        const err = new Error('The operation was aborted')
        err.name = 'AbortError'
        reject(err)
      })
    })))
    await expect(callOpenAI({
      modelName: 'm',
      systemPrompt: 's',
      userContent: 'u',
      responseSchema: {},
      timeoutMs: 5,
    })).rejects.toMatchObject({ name: 'AbortError' })
  }, 2000)
})
