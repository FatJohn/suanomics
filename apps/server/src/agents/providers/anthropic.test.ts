import { beforeEach, describe, expect, it, vi } from 'vitest'
import { callAnthropic } from './anthropic.js'

const createMock = vi.fn()
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn(() => {
    return { messages: { create: createMock } }
  }),
}))

describe('callAnthropic', () => {
  beforeEach(() => {
    createMock.mockReset()
    process.env.ANTHROPIC_API_KEY = 'test'
  })

  it('builds a forced tool-use request (tool emit_result, input_schema = responseSchema, tool_choice forced)', async () => {
    const schema = { type: 'object', properties: { headline: { type: 'string' } } }
    createMock.mockResolvedValue({
      content: [{ type: 'tool_use', name: 'emit_result', input: { headline: 'x' } }],
      usage: { input_tokens: 10, output_tokens: 5 },
    })

    await callAnthropic({
      modelName: 'claude-sonnet-4-6',
      systemPrompt: 'sys',
      userContent: 'user',
      responseSchema: schema,
      timeoutMs: 30_000,
      maxTokens: 4096,
    })

    expect(createMock).toHaveBeenCalledTimes(1)
    const req = createMock.mock.calls[0]?.[0]
    expect(req.model).toBe('claude-sonnet-4-6')
    expect(req.max_tokens).toBe(4096)
    expect(req.system).toEqual([{ type: 'text', text: 'sys', cache_control: { type: 'ephemeral' } }])
    expect(req.messages).toEqual([{ role: 'user', content: 'user' }])
    expect(req.tools[0].name).toBe('emit_result')
    expect(req.tools[0].input_schema).toEqual(schema)
    expect(req.tool_choice).toEqual({ type: 'tool', name: 'emit_result' })
  })

  it('returns the tool input as raw result with usage tokens', async () => {
    const input = { headline: 'hello', body: 'world' }
    createMock.mockResolvedValue({
      content: [{ type: 'tool_use', name: 'emit_result', input }],
      usage: { input_tokens: 123, output_tokens: 45 },
    })

    const res = await callAnthropic({
      modelName: 'claude-sonnet-4-6',
      systemPrompt: 's',
      userContent: 'u',
      responseSchema: {},
      timeoutMs: 30_000,
      maxTokens: 4096,
    })

    expect(res.raw).toEqual(input)
    expect(res.tokensIn).toBe(123)
    expect(res.tokensOut).toBe(45)
  })

  it('回傳 cache token（cache_read / cache_creation）', async () => {
    createMock.mockResolvedValue({
      content: [{ type: 'tool_use', name: 'emit_result', input: { ok: 1 } }],
      usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 800, cache_creation_input_tokens: 20 },
    })
    const res = await callAnthropic({
      modelName: 'claude-sonnet-4-6',
      systemPrompt: 's',
      userContent: 'u',
      responseSchema: {},
      timeoutMs: 30_000,
      maxTokens: 4096,
    })
    expect(res.cachedReadTokens).toBe(800)
    expect(res.cacheWriteTokens).toBe(20)
  })

  it('usage 無 cache 欄位 → cache token = 0', async () => {
    createMock.mockResolvedValue({
      content: [{ type: 'tool_use', name: 'emit_result', input: { ok: 1 } }],
      usage: { input_tokens: 10, output_tokens: 5 },
    })
    const res = await callAnthropic({
      modelName: 'claude-sonnet-4-6',
      systemPrompt: 's',
      userContent: 'u',
      responseSchema: {},
      timeoutMs: 30_000,
      maxTokens: 4096,
    })
    expect(res.cachedReadTokens).toBe(0)
    expect(res.cacheWriteTokens).toBe(0)
  })

  it('throws a labeled error when no tool_use block is returned', async () => {
    createMock.mockResolvedValue({
      content: [{ type: 'text', text: 'no tool here' }],
      usage: { input_tokens: 1, output_tokens: 1 },
    })

    await expect(callAnthropic({
      modelName: 'claude-sonnet-4-6',
      systemPrompt: 's',
      userContent: 'u',
      responseSchema: {},
      timeoutMs: 30_000,
      maxTokens: 4096,
    })).rejects.toThrow(/no tool_use block/)
  })
})
