import type { LlmCallRecord } from './llm-wrapper.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { callAgentLLM } from './llm-wrapper.js'
import { priceFor } from './providers/pricing.js'
import { AGENT_MODEL_DEFAULTS, resetProviderWarnCache } from './providers/resolve.js'

const generateContentMock = vi.fn()
vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: { generateContent: generateContentMock },
  })),
}))

const anthropicCreateMock = vi.fn()
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn(() => {
    return { messages: { create: anthropicCreateMock } }
  }),
}))

describe('callAgentLLM', () => {
  beforeEach(() => {
    generateContentMock.mockReset()
    anthropicCreateMock.mockReset()
    process.env.GEMINI_API_KEY = 'test'
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    resetProviderWarnCache()
  })

  it('should parse JSON response and return typed result', async () => {
    generateContentMock.mockResolvedValue({
      text: '{"foo": "bar"}',
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20 },
    })
    const records: LlmCallRecord[] = []
    const result = await callAgentLLM<{ foo: string }>({
      agentName: 'decomposer',
      systemPrompt: 's',
      userContent: 'u',
      responseSchema: { type: 'object' },
      onCallRecord: r => records.push(r),
    })
    expect(result).toEqual({ foo: 'bar' })
    expect(records).toHaveLength(1)
    expect(records[0]?.agentName).toBe('decomposer')
    expect(records[0]?.tokensIn).toBe(100)
    expect(records[0]?.tokensOut).toBe(20)
    expect(records[0]?.attempts).toBe(1)
    // mock 呼叫可能在同一毫秒內完成、>= 0 避免快機器上的 timing flake
    expect(records[0]?.latencyMs).toBeGreaterThanOrEqual(0)
  })

  it('should retry on transient error and merge attempts in record', async () => {
    generateContentMock.mockRejectedValueOnce(new Error('network'))
    generateContentMock.mockResolvedValue({
      text: '{}',
      usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 10 },
    })
    const records: LlmCallRecord[] = []
    await callAgentLLM({
      agentName: 'analyst-tier1',
      systemPrompt: 's',
      userContent: 'u',
      responseSchema: { type: 'object' },
      onCallRecord: r => records.push(r),
      maxRetries: 3,
      retryDelayMs: 1,
    })
    expect(records[0]?.attempts).toBe(2)
  })

  it('should throw after maxRetries exhausted', async () => {
    generateContentMock.mockRejectedValue(new Error('timeout'))
    await expect(callAgentLLM({
      agentName: 'analyst-tier1',
      systemPrompt: 's',
      userContent: 'u',
      responseSchema: {},
      maxRetries: 2,
      retryDelayMs: 1,
    })).rejects.toThrow(/timeout/)
  })

  it('should NOT retry on AbortError', async () => {
    generateContentMock.mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    await expect(callAgentLLM({
      agentName: 'decomposer',
      systemPrompt: 's',
      userContent: 'u',
      responseSchema: {},
      maxRetries: 5,
      retryDelayMs: 1,
    })).rejects.toThrow(/aborted/)
    expect(generateContentMock).toHaveBeenCalledTimes(1)
  })

  it('should compute cost using tokens (Gemini Flash rates)', async () => {
    generateContentMock.mockResolvedValue({
      text: '{}',
      usageMetadata: { promptTokenCount: 1_000_000, candidatesTokenCount: 1_000_000 },
    })
    const records: LlmCallRecord[] = []
    await callAgentLLM({
      agentName: 'synthesizer',
      systemPrompt: 's',
      userContent: 'u',
      responseSchema: {},
      onCallRecord: r => records.push(r),
    })
    // ★ 單價從 priceFor 取、不在這裡重抄一份：這條測的是「成本有沒有走 per-model 價目表」，
    // 價目表本身由 pricing.test.ts 釘。寫死的話每次調價都要改兩個地方，而漏改的那個會變成
    // 「測試綠、成本錯」（2026-08-23 換 3.7 時就是這樣紅的）。
    const syn = priceFor('gemini', AGENT_MODEL_DEFAULTS.synthesizer)
    expect(records[0]?.costUsd).toBeCloseTo(syn.input + syn.output, 3)
  })

  it('uses per-agent timeout when not explicitly provided', async () => {
    // Spy on global setTimeout to capture the timeout value passed to callAgentLLM
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    generateContentMock.mockResolvedValue({
      text: '{}',
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10 },
    })
    await callAgentLLM({
      agentName: 'decomposer',
      systemPrompt: 's',
      userContent: 'u',
      responseSchema: {},
      maxRetries: 1,
    })
    // The first setTimeout call in callAgentLLM is the abort timer; check it used 30_000 (decomposer)
    const abortTimerCall = setTimeoutSpy.mock.calls.find(args => args[1] === 30_000)
    expect(abortTimerCall, 'decomposer should use 30_000ms abort timer').toBeDefined()
    setTimeoutSpy.mockRestore()
  })

  it('routes an AGENT_MODELS claude-overridden agent to anthropic and tags the record', async () => {
    vi.stubEnv('AGENT_MODELS', 'synthesizer:claude-sonnet-4-6')
    vi.stubEnv('ANTHROPIC_API_KEY', 'anthropic-key')
    vi.stubEnv('AI_PROVIDER', 'anthropic')
    anthropicCreateMock.mockResolvedValue({
      content: [{ type: 'tool_use', name: 'emit_result', input: { ok: true } }],
      usage: { input_tokens: 100, output_tokens: 20 },
    })
    const records: LlmCallRecord[] = []
    const result = await callAgentLLM<{ ok: boolean }>({
      agentName: 'synthesizer',
      systemPrompt: 's',
      userContent: 'u',
      responseSchema: { type: 'object' },
      onCallRecord: r => records.push(r),
    })

    expect(result).toEqual({ ok: true })
    expect(anthropicCreateMock).toHaveBeenCalledTimes(1)
    expect(generateContentMock).not.toHaveBeenCalled()
    expect(records[0]?.provider).toBe('anthropic')
  })

  it('keeps a non-overridden agent on gemini even when AGENT_MODELS overrides another', async () => {
    vi.stubEnv('AGENT_MODELS', 'synthesizer:claude-sonnet-4-6')
    vi.stubEnv('ANTHROPIC_API_KEY', 'anthropic-key')
    generateContentMock.mockResolvedValue({
      text: '{}',
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
    })
    const records: LlmCallRecord[] = []
    await callAgentLLM({
      agentName: 'decomposer',
      systemPrompt: 's',
      userContent: 'u',
      responseSchema: { type: 'object' },
      onCallRecord: r => records.push(r),
    })

    expect(generateContentMock).toHaveBeenCalledTimes(1)
    expect(anthropicCreateMock).not.toHaveBeenCalled()
    expect(records[0]?.provider).toBe('gemini')
  })

  it('computes cost from per-model price (decomposer → flash $1.5/$9)', async () => {
    generateContentMock.mockResolvedValue({
      text: '{}',
      usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 1000 },
    })
    const records: LlmCallRecord[] = []
    await callAgentLLM({ agentName: 'decomposer', systemPrompt: 's', userContent: 'u', responseSchema: {}, onCallRecord: r => records.push(r) })
    const dec = priceFor('gemini', AGENT_MODEL_DEFAULTS.decomposer)
    expect(records[0]?.costUsd).toBeCloseTo((1000 * dec.input + 1000 * dec.output) / 1e6, 6)
    expect(records[0]?.provider).toBe('gemini')
  })

  it('narrative-writer defaults to gemini-3.1-pro-preview pricing ($2/$12)', async () => {
    generateContentMock.mockResolvedValue({
      text: '{}',
      usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 1000 },
    })
    const records: LlmCallRecord[] = []
    await callAgentLLM({ agentName: 'narrative-writer', systemPrompt: 's', userContent: 'u', responseSchema: {}, onCallRecord: r => records.push(r) })
    // (1000*2.00 + 1000*12.00)/1e6 = 0.014
    expect(records[0]?.costUsd).toBeCloseTo(0.014, 6)
    // 確認帶對 model 給 provider
    const callModel = generateContentMock.mock.calls[0]?.[0]?.model
    expect(callModel).toBe('gemini-3.1-pro-preview')
  })

  it('routes to anthropic + sonnet pricing when AGENT_MODELS overrides to claude (key present)', async () => {
    vi.stubEnv('AGENT_MODELS', 'synthesizer:claude-sonnet-4-6')
    vi.stubEnv('ANTHROPIC_API_KEY', 'k')
    vi.stubEnv('AI_PROVIDER', 'anthropic')
    anthropicCreateMock.mockResolvedValue({
      content: [{ type: 'tool_use', input: {} }],
      usage: { input_tokens: 1000, output_tokens: 1000 },
    })
    const records: LlmCallRecord[] = []
    await callAgentLLM({ agentName: 'synthesizer', systemPrompt: 's', userContent: 'u', responseSchema: {}, onCallRecord: r => records.push(r) })
    expect(records[0]?.provider).toBe('anthropic')
    // (1000*3.00 + 1000*15.00)/1e6 = 0.018
    expect(records[0]?.costUsd).toBeCloseTo(0.018, 6)
  })

  it('gemini cached token → cost 走 computeCost 折扣 + record 帶 cachedReadTokens', async () => {
    vi.stubEnv('AGENT_MODELS', '') // decomposer 走預設 gemini-3.5-flash（gemini 不受 gate 影響）
    generateContentMock.mockResolvedValue({
      text: '{"ok":1}',
      usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 500, cachedContentTokenCount: 800 },
    })
    let rec: LlmCallRecord | undefined
    await callAgentLLM({
      agentName: 'decomposer',
      systemPrompt: 's',
      userContent: 'u',
      responseSchema: {},
      onCallRecord: (r) => { rec = r },
    })
    // regular=200、cached=800*0.25（Gemini 隱式快取 0.25x）
    const p = priceFor('gemini', AGENT_MODEL_DEFAULTS.decomposer)
    expect(rec?.cachedReadTokens).toBe(800)
    expect(rec?.costUsd).toBeCloseTo(((1000 - 800 + 800 * 0.25) * p.input + 500 * p.output) / 1e6, 10)
  })
})

// fanout-concurrency.ts 的四個常數是 module-load 時就算完的（`fanoutConcurrency()`
// 讀 process.env 一次），所以要驗證「stub 過的 env 真的讓警告印出來」必須 resetModules +
// 動態 import 重新跑一次那個 module body——只 vi.stubEnv 不 resetModules 的話，`callAgentLLM`
// 讀到的還是本檔最上面靜態 import 時就凍結的舊常數。
describe('callAgentLLM：並行預算警告掛點', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('尖峰超標時第一次呼叫前印一次警告（含 tier1 生效值與門檻名），且早於 provider 呼叫', async () => {
    vi.resetModules()
    vi.stubEnv('ANALYST_TIER1_FANOUT_CONCURRENCY', '4') // peak = max(3,3,4*3) = 12 > MAX_SAFE_LLM_PEAK=10
    process.env.GEMINI_API_KEY = 'test'
    generateContentMock.mockReset()
    generateContentMock.mockResolvedValue({
      text: '{}',
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10 },
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { callAgentLLM: freshCallAgentLLM } = await import('./llm-wrapper.js')
    const { resetLlmConcurrencyBudgetWarnCache } = await import('./fanout-concurrency.js')
    resetLlmConcurrencyBudgetWarnCache()

    await freshCallAgentLLM({ agentName: 'decomposer', systemPrompt: 's', userContent: 'u', responseSchema: {} })
    await freshCallAgentLLM({ agentName: 'decomposer', systemPrompt: 's', userContent: 'u', responseSchema: {} })

    expect(errorSpy).toHaveBeenCalledTimes(1) // 第二次呼叫不再印（once-guard）
    const message = errorSpy.mock.calls[0]?.[0] as string
    expect(message).toContain('tier1=4')
    expect(message).toContain('MAX_SAFE_LLM_PEAK')

    const warnOrder = errorSpy.mock.invocationCallOrder[0]
    const providerOrder = generateContentMock.mock.invocationCallOrder[0]
    expect(warnOrder).toBeDefined()
    expect(providerOrder).toBeDefined()
    expect(warnOrder as number).toBeLessThan(providerOrder as number)
    errorSpy.mockRestore()
  })

  it('負向對照：預設 env（peak=9，在門檻內）完全不印', async () => {
    vi.resetModules()
    process.env.GEMINI_API_KEY = 'test'
    generateContentMock.mockReset()
    generateContentMock.mockResolvedValue({
      text: '{}',
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10 },
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { callAgentLLM: freshCallAgentLLM } = await import('./llm-wrapper.js')
    const { resetLlmConcurrencyBudgetWarnCache } = await import('./fanout-concurrency.js')
    resetLlmConcurrencyBudgetWarnCache()

    await freshCallAgentLLM({ agentName: 'decomposer', systemPrompt: 's', userContent: 'u', responseSchema: {} })

    expect(errorSpy).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})
