import { APICallError, generateText, NoObjectGeneratedError } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { callAgent } from './call-agent.js'
import { DailyCostGate, DailyCostLimitExceededError } from './cost-gate.js'

vi.mock('ai', async importOriginal => ({
  ...await importOriginal<typeof import('ai')>(),
  generateText: vi.fn(),
}))

const generate = vi.mocked(generateText)
const schema = z.object({ ok: z.boolean() })
const input = { systemPrompt: 'sys', userContent: 'user' }
const usage = {
  inputTokens: 1_000_000,
  outputTokens: 0,
  inputTokenDetails: { noCacheTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0 },
}

function succeed(): void {
  generate.mockResolvedValueOnce({ output: { ok: true }, usage } as never)
}
function apiError(statusCode: number | undefined, isRetryable: boolean): APICallError {
  return new APICallError({
    message: 'boom',
    url: 'https://example.test',
    requestBodyValues: {},
    isRetryable,
    ...(statusCode !== undefined ? { statusCode } : {}),
  })
}

beforeEach(() => {
  generate.mockReset()
})

describe('callAgent 的 AI SDK 呼叫', () => {
  it('system prompt 帶 anthropic cacheControl，關閉 SDK 內建 retry', async () => {
    succeed()
    await callAgent('news-tagger', input, schema, { gate: new DailyCostGate(1) })
    expect(generate.mock.calls[0]?.[0]).toMatchObject({
      system: { role: 'system', content: 'sys', providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } } },
      prompt: 'user',
      maxRetries: 0,
    })
  })

  it('回傳 output 並回報 record', async () => {
    succeed()
    const onCallRecord = vi.fn()
    const gate = new DailyCostGate(1)
    await expect(callAgent('news-tagger', input, schema, { gate, onCallRecord, newsId: 'n1' })).resolves.toEqual({ ok: true })
    expect(onCallRecord.mock.calls[0]?.[0]).toMatchObject({ agentName: 'news-tagger', newsId: 'n1', provider: 'anthropic', tokensIn: 1_000_000, attempts: 1 })
    expect(gate.totalUsd).toBeCloseTo(0.1, 10)
  })
})

describe('callAgent 的花費閘', () => {
  it('超過上限時不打 API，丟 DailyCostLimitExceededError', async () => {
    const gate = new DailyCostGate(1)
    gate.record(1.01)
    await expect(callAgent('news-tagger', input, schema, { gate })).rejects.toBeInstanceOf(DailyCostLimitExceededError)
    expect(generate).not.toHaveBeenCalled()
  })

  it('輸出不符 schema 時已計費的 token 仍累計', async () => {
    const gate = new DailyCostGate(1)
    generate.mockRejectedValueOnce(new NoObjectGeneratedError({
      message: 'bad',
      text: '{}',
      response: { id: 'r', timestamp: new Date(), modelId: 'm' },
      usage: usage as never,
      finishReason: 'stop',
    }))
    await expect(callAgent('news-tagger', input, schema, { gate })).rejects.toBeInstanceOf(NoObjectGeneratedError)
    expect(gate.totalUsd).toBeCloseTo(0.1, 10)
    expect(generate).toHaveBeenCalledTimes(1)
  })

  it('沒有價格的 model 在呼叫前拒絕', async () => {
    vi.stubEnv('AGENT_MODELS', 'news-tagger:anthropic/claude-unpriced')
    await expect(callAgent('news-tagger', input, schema, { gate: new DailyCostGate(1) })).rejects.toThrow(/claude-unpriced/)
    expect(generate).not.toHaveBeenCalled()
    vi.unstubAllEnvs()
  })
})

describe('callAgent 的 retry', () => {
  it.each([
    ['429', apiError(429, true)],
    ['500', apiError(500, true)],
    ['529', apiError(529, true)],
    ['連線錯誤', apiError(undefined, true)],
  ])('%s 會重試', async (_label, error) => {
    generate.mockRejectedValueOnce(error)
    succeed()
    const onCallRecord = vi.fn()
    await callAgent('news-tagger', input, schema, { gate: new DailyCostGate(1), retryDelayMs: 0, onCallRecord })
    expect(generate).toHaveBeenCalledTimes(2)
    expect(onCallRecord.mock.calls[0]?.[0]).toMatchObject({ attempts: 2 })
  })

  it.each([
    ['400', apiError(400, false)],
    ['408', apiError(408, true)],
    ['409', apiError(409, true)],
    ['timeout', new DOMException('timed out', 'TimeoutError')],
  ])('%s 不重試', async (_label, error) => {
    generate.mockRejectedValueOnce(error)
    await expect(callAgent('news-tagger', input, schema, { gate: new DailyCostGate(1), retryDelayMs: 0 })).rejects.toBe(error)
    expect(generate).toHaveBeenCalledTimes(1)
  })

  it('達到 maxAttempts 後丟出最後的錯誤', async () => {
    const error = apiError(503, true)
    generate.mockRejectedValue(error)
    await expect(callAgent('news-tagger', input, schema, { gate: new DailyCostGate(1), retryDelayMs: 0, maxAttempts: 3 })).rejects.toBe(error)
    expect(generate).toHaveBeenCalledTimes(3)
  })
})
