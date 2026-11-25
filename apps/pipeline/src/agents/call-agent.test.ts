import type { LlmLedger, LlmLedgerRow } from './cost-gate.js'
import { setTimeout as delay } from 'node:timers/promises'
import { APICallError, generateText, NoObjectGeneratedError } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { callAgent } from './call-agent.js'
import { DailyCostGate, DailyCostLimitExceededError, LlmAccountError } from './cost-gate.js'
import { PRICE_VERSION } from './pricing.js'

vi.mock('node:timers/promises', () => ({ setTimeout: vi.fn(async () => undefined) }))
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
function apiError(statusCode: number | undefined, isRetryable: boolean, responseHeaders?: Record<string, string>): APICallError {
  return new APICallError({
    message: 'boom',
    url: 'https://example.test',
    requestBodyValues: {},
    isRetryable,
    ...(statusCode !== undefined ? { statusCode } : {}),
    ...(responseHeaders ? { responseHeaders } : {}),
  })
}

beforeEach(() => {
  generate.mockReset()
  vi.mocked(delay).mockClear()
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
    const onCallRecord = vi.fn()
    await expect(callAgent('news-tagger', input, schema, { gate, onCallRecord })).rejects.toBeInstanceOf(NoObjectGeneratedError)
    expect(gate.totalUsd).toBeCloseTo(0.1, 10)
    expect(generate).toHaveBeenCalledTimes(1)
    expect(onCallRecord.mock.calls[0]?.[0]).toMatchObject({ agentName: 'news-tagger', costUsd: expect.closeTo(0.1, 10), attempts: 1 })
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
    ['採用較長的 retry-after', '30', 30_000],
    ['retry-after 短於 backoff 時用 backoff', '0', 1_000],
    ['超過 60 秒的值不採用', '120', 1_000],
    ['不是數字的值不採用', 'soon', 1_000],
  ])('%s', async (_label, header, expectedMs) => {
    generate.mockRejectedValueOnce(apiError(429, true, { 'retry-after': header }))
    succeed()
    await callAgent('news-tagger', input, schema, { gate: new DailyCostGate(1) })
    expect(delay).toHaveBeenCalledWith(expectedMs)
  })

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

describe('callAgent 寫帳本', () => {
  function ledgerGate(limitUsd = 10): { gate: DailyCostGate, rows: LlmLedgerRow[] } {
    const rows: LlmLedgerRow[] = []
    const ledger: LlmLedger = {
      insert: async (r) => {
        rows.push(r)
      },
    }
    return { gate: new DailyCostGate(limitUsd, { ledger, retryDelayMs: 0 }), rows }
  }

  it('成功時寫一列，四種 token 互斥，帶 model 與 price_version；onCallRecord 也有 model', async () => {
    succeed()
    const { gate, rows } = ledgerGate()
    const onCallRecord = vi.fn()
    await callAgent('news-tagger', input, schema, { gate, newsId: 'n1', onCallRecord })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ agent: 'news-tagger', newsId: 'n1', provider: 'anthropic', tokensIn: 1_000_000, tokensOut: 0, cacheReadTokens: 0, cacheWriteTokens: 0, attempts: 1, status: 'ok', priceVersion: PRICE_VERSION })
    expect(rows[0]?.model).toEqual(expect.any(String))
    expect(rows[0]?.costUsd).toBeCloseTo(0.1, 10)
    expect(onCallRecord.mock.calls[0]?.[0]).toMatchObject({ model: rows[0]?.model })
  })

  it('503 後重試成功只寫一列，attempts 為 2，閘只累計一次', async () => {
    generate.mockRejectedValueOnce(apiError(503, true))
    succeed()
    const { gate, rows } = ledgerGate()
    await callAgent('news-tagger', input, schema, { gate, retryDelayMs: 0 })
    expect(generate).toHaveBeenCalledTimes(2)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ attempts: 2, status: 'ok' })
    expect(gate.callCount).toBe(1)
    expect(rows[0]?.costUsd).toBeCloseTo(gate.totalUsd, 10)
  })

  it('輸出不符 schema 時記實際用量，只寫一列', async () => {
    generate.mockRejectedValueOnce(new NoObjectGeneratedError({ message: 'bad', response: {} as never, usage, finishReason: 'stop' } as never))
    const { gate, rows } = ledgerGate()
    await expect(callAgent('news-tagger', input, schema, { gate })).rejects.toBeInstanceOf(NoObjectGeneratedError)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ status: 'invalid_output', tokensIn: 1_000_000 })
    expect(rows[0]?.costUsd).toBeCloseTo(0.1, 10)
  })

  it('重試用盡寫一列 failed，cost 為 null，丟回原本的錯誤', async () => {
    const error = apiError(503, true)
    generate.mockRejectedValue(error)
    const { gate, rows } = ledgerGate()
    await expect(callAgent('news-tagger', input, schema, { gate, retryDelayMs: 0, maxAttempts: 3 })).rejects.toBe(error)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ status: 'failed', attempts: 3, costUsd: null, tokensIn: 0, tokensOut: 0 })
    expect(gate.totalUsd).toBe(0)
    expect(gate.callCount).toBe(1)
  })

  it('記帳失敗不重打 API、不補 failed 列，輸出照回', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    succeed()
    const insert = vi.fn(async () => {
      throw new Error('db down')
    })
    const gate = new DailyCostGate(10, { retryDelayMs: 0, ledger: { insert } })
    await expect(callAgent('news-tagger', input, schema, { gate, retryDelayMs: 0 })).resolves.toEqual({ ok: true })
    expect(generate).toHaveBeenCalledTimes(1)
    expect(insert).toHaveBeenCalledTimes(3)
    error.mockRestore()
  })

  it('重試等待中撞到花費閘時留一列 failed，attempts 為已打過的次數', async () => {
    const { gate, rows } = ledgerGate(1)
    generate.mockRejectedValueOnce(apiError(503, true))
    vi.mocked(delay).mockImplementationOnce(async () => {
      gate.record(2)
      return undefined as never
    })
    await expect(callAgent('news-tagger', input, schema, { gate, retryDelayMs: 0 })).rejects.toBeInstanceOf(DailyCostLimitExceededError)
    expect(generate).toHaveBeenCalledTimes(1)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ status: 'failed', attempts: 1, costUsd: null })
  })

  it('onCallRecord 的 latency 與帳本同值，不含寫帳本的時間', async () => {
    succeed()
    const rows: LlmLedgerRow[] = []
    const gate = new DailyCostGate(10, {
      ledger: {
        insert: async (r) => {
          rows.push(r)
          await new Promise(resolve => setImmediate(resolve))
          await new Promise(resolve => setTimeout(resolve, 15))
        },
      },
    })
    const onCallRecord = vi.fn()
    await callAgent('news-tagger', input, schema, { gate, onCallRecord })
    expect(onCallRecord.mock.calls[0]?.[0].latencyMs).toBe(rows[0]?.latencyMs)
  })

  it('花費閘已超過上限時不打 API 也不寫列', async () => {
    const { gate, rows } = ledgerGate(1)
    gate.record(1.5)
    await expect(callAgent('news-tagger', input, schema, { gate })).rejects.toBeInstanceOf(DailyCostLimitExceededError)
    expect(generate).not.toHaveBeenCalled()
    expect(rows).toHaveLength(0)
  })

  it('額度錯誤不重試，寫一列 failed 後丟 LlmAccountError', async () => {
    generate.mockRejectedValue(new APICallError({
      message: 'cap',
      url: 'https://example.test',
      requestBodyValues: {},
      statusCode: 429,
      isRetryable: true,
      data: { type: 'error', error: { type: 'rate_limit_error', message: 'cap', details: { error_code: 'enforced_spend_limit_reached' } } },
    }))
    const { gate, rows } = ledgerGate()
    await expect(callAgent('news-tagger', input, schema, { gate, retryDelayMs: 0 })).rejects.toBeInstanceOf(LlmAccountError)
    expect(generate).toHaveBeenCalledTimes(1)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ status: 'failed', costUsd: null })
  })
})
