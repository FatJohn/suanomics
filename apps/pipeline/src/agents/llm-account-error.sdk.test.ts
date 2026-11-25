import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { callAgent } from './call-agent.js'
import { DailyCostGate, LlmAccountError } from './cost-gate.js'

// 不 mock ai：用假 fetch 走真的 @ai-sdk/anthropic，確認官方文件的回應形狀真的會落到 APICallError.data。
const schema = z.object({ ok: z.boolean() })
const input = { systemPrompt: 's', userContent: 'u' }

function stubResponse(status: number, payload: unknown): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('callAgent 經真實 SDK 收到帳務錯誤', () => {
  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it.each([
    [402, { type: 'error', error: { type: 'billing_error', message: 'payment' } }],
    [400, { type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' } }],
    [400, { type: 'error', error: { type: 'invalid_request_error', message: 'You have reached your specified API usage limits. You will regain access on 2026-12-01 at 00:00 UTC.' } }],
    [429, { type: 'error', error: { type: 'rate_limit_error', message: 'cap', details: { error_code: 'enforced_spend_limit_reached' } } }],
    [401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }],
  ])('hTTP %i 丟 LlmAccountError 且只打一次', async (status, payload) => {
    const fetchMock = stubResponse(status, payload)
    await expect(callAgent('news-tagger', input, schema, { gate: new DailyCostGate(1), retryDelayMs: 0 })).rejects.toBeInstanceOf(LlmAccountError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('一般 400 維持原本的錯誤', async () => {
    stubResponse(400, { type: 'error', error: { type: 'invalid_request_error', message: 'max_tokens: too large' } })
    const rejected = await callAgent('news-tagger', input, schema, { gate: new DailyCostGate(1), retryDelayMs: 0 }).catch((e: unknown) => e)
    expect(rejected).not.toBeInstanceOf(LlmAccountError)
    expect(rejected).toBeInstanceOf(Error)
  })
})
