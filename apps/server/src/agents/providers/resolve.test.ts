import { afterEach, describe, expect, it, vi } from 'vitest'
import { AGENT_MODEL_DEFAULTS, defaultProviderFromEnv, parseModelSpec, providerForModel, resetProviderWarnCache, resolveAgentModel } from './resolve.js'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  resetProviderWarnCache()
})

describe('providerForModel', () => {
  it('claude* → anthropic、其餘 → gemini', () => {
    expect(providerForModel('claude-sonnet-4-6')).toBe('anthropic')
    expect(providerForModel('gemini-3.5-flash')).toBe('gemini')
    expect(providerForModel('gemini-3.1-pro-preview')).toBe('gemini')
  })
})

describe('resolveAgentModel', () => {
  it('用 AGENT_MODEL_DEFAULTS（主推理層→3.7-flash、narrative→3.1-pro、judge 留 3.5-flash、podcast→3-flash-preview）', () => {
    expect(resolveAgentModel('narrative-writer')).toEqual({ provider: 'gemini', model: 'gemini-3.1-pro-preview' })
    expect(resolveAgentModel('decomposer')).toEqual({ provider: 'gemini', model: 'gemini-3.7-flash' })
    expect(resolveAgentModel('podcast-writer')).toEqual({ provider: 'gemini', model: 'gemini-3-flash-preview' })
    expect(resolveAgentModel('brief-continuity-judge')).toEqual({ provider: 'gemini', model: 'gemini-3.5-flash' })
    // 直接斷言 AGENT_MODEL_DEFAULTS 有此鍵：若移除 resolve.ts 的註冊行、此斷言變 undefined !== string → fail
    expect(AGENT_MODEL_DEFAULTS['brief-continuity-judge']).toBe('gemini-3.5-flash')
  })
  it('低複雜度高量 agent 走 flash-lite（分層降本、2026-08-02）', () => {
    for (const agent of ['news-categorizer', 'news-tagger', 'chain-grouper', 'corpus-entity-summary'] as const) {
      expect(AGENT_MODEL_DEFAULTS[agent]).toBe('gemini-3.5-flash-lite')
      expect(resolveAgentModel(agent)).toEqual({ provider: 'gemini', model: 'gemini-3.5-flash-lite' })
    }
  })
  // 這一條的前身是「待評估的 agent 維持現值」，2026-08-02 寫來擋「沒量測就順手換」。
  // 2026-08-23 換 3.7 時它確實擋下來了。有量測之後改成守新的分工——**不是刪掉**：
  // 每一組都要說得出為什麼在那裡，改動它就得先回答同一個問題。
  it('★ 每個 agent 待在它現在的 model 都要有理由（換之前先回答為什麼）', () => {
    // 主推理層：品質量不出差異、折扣期內 input 半價（2026-08-23 A/B）
    for (const agent of ['decomposer', 'analyst-tier1', 'analyst-tier2', 'synthesizer', 'editor', 'viewpoints-debate'] as const)
      expect(AGENT_MODEL_DEFAULTS[agent], agent).toBe('gemini-3.7-flash')
    // 量尺本身：換掉 judge 會讓歷史品質趨勢紀錄不可比，而且有它自己的程序
    for (const agent of ['brief-judge', 'brief-quality-judge', 'brief-continuity-judge'] as const)
      expect(AGENT_MODEL_DEFAULTS[agent], agent).toBe('gemini-3.5-flash')
    // A/B 證實 pro 的報告品質明顯較好
    expect(AGENT_MODEL_DEFAULTS['narrative-writer']).toBe('gemini-3.1-pro-preview')
    // $0.50/$3.00，換到任何一個 3.x flash 兩側都是漲價；pin 另有 citationUrls 的歷史原因
    expect(AGENT_MODEL_DEFAULTS['podcast-writer']).toBe('gemini-3-flash-preview')
  })
  it('corpus-entity-summary 可被 AGENT_MODELS override', () => {
    vi.stubEnv('AGENT_MODELS', 'corpus-entity-summary:gemini-3-flash-preview')
    expect(resolveAgentModel('corpus-entity-summary')).toEqual({ provider: 'gemini', model: 'gemini-3-flash-preview' })
  })
  it('env AGENT_MODELS 逐 agent override', () => {
    vi.stubEnv('AGENT_MODELS', 'narrative-writer:gemini-3.5-flash')
    expect(resolveAgentModel('narrative-writer')).toEqual({ provider: 'gemini', model: 'gemini-3.5-flash' })
    expect(resolveAgentModel('decomposer')).toEqual({ provider: 'gemini', model: 'gemini-3.7-flash' }) // 未 override 走預設
  })
  it('claude override + key present + AI_PROVIDER=anthropic → anthropic', () => {
    vi.stubEnv('AGENT_MODELS', 'synthesizer:claude-sonnet-4-6')
    vi.stubEnv('ANTHROPIC_API_KEY', 'k')
    vi.stubEnv('AI_PROVIDER', 'anthropic')
    expect(resolveAgentModel('synthesizer')).toEqual({ provider: 'anthropic', model: 'claude-sonnet-4-6' })
  })
  it('claude override 但缺 key → fallback gemini-3.5-flash + 大聲一次', () => {
    vi.stubEnv('AGENT_MODELS', 'synthesizer:claude-sonnet-4-6')
    vi.stubEnv('ANTHROPIC_API_KEY', '') // 本機 apps/server/.env 可能帶 key、明確清掉確保「缺 key」情境
    // console.error 而非 warn：靜默換 provider 是帳單與品質都變了的事，音量刻意調高。
    const shout = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(resolveAgentModel('synthesizer')).toEqual({ provider: 'gemini', model: 'gemini-3.5-flash' })
    expect(resolveAgentModel('synthesizer')).toEqual({ provider: 'gemini', model: 'gemini-3.5-flash' })
    expect(shout).toHaveBeenCalledTimes(1)
  })
  it('空 ANTHROPIC_API_KEY 視為缺、fallback', () => {
    vi.stubEnv('AGENT_MODELS', 'synthesizer:claude-sonnet-4-6')
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    const shout = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(resolveAgentModel('synthesizer').provider).toBe('gemini')
    expect(shout).toHaveBeenCalledTimes(1)
  })
  it('claude override + key + AI_PROVIDER=anthropic → anthropic', () => {
    vi.stubEnv('AGENT_MODELS', 'analyst-tier1:claude-sonnet-4-6')
    vi.stubEnv('ANTHROPIC_API_KEY', 'k')
    vi.stubEnv('AI_PROVIDER', 'anthropic')
    expect(resolveAgentModel('analyst-tier1')).toEqual({ provider: 'anthropic', model: 'claude-sonnet-4-6' })
  })

  it('claude override + key 但 AI_PROVIDER 未設（預設關）→ fallback gemini + 大聲一次', () => {
    vi.stubEnv('AGENT_MODELS', 'analyst-tier1:claude-sonnet-4-6')
    vi.stubEnv('ANTHROPIC_API_KEY', 'k')
    vi.stubEnv('AI_PROVIDER', '') // 未設
    const shout = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(resolveAgentModel('analyst-tier1')).toEqual({ provider: 'gemini', model: 'gemini-3.5-flash' })
    expect(resolveAgentModel('analyst-tier1')).toEqual({ provider: 'gemini', model: 'gemini-3.5-flash' })
    expect(shout).toHaveBeenCalledTimes(1)
  })

  it('claude override + key + AI_PROVIDER=gemini → fallback gemini（總開關關）', () => {
    vi.stubEnv('AGENT_MODELS', 'analyst-tier1:claude-sonnet-4-6')
    vi.stubEnv('ANTHROPIC_API_KEY', 'k')
    vi.stubEnv('AI_PROVIDER', 'gemini')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(resolveAgentModel('analyst-tier1')).toEqual({ provider: 'gemini', model: 'gemini-3.5-flash' })
  })

  it('gate 開但缺 ANTHROPIC_API_KEY → fallback gemini（仍需 key）', () => {
    vi.stubEnv('AGENT_MODELS', 'analyst-tier1:claude-sonnet-4-6')
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    vi.stubEnv('AI_PROVIDER', 'anthropic')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(resolveAgentModel('analyst-tier1')).toEqual({ provider: 'gemini', model: 'gemini-3.5-flash' })
  })

  it('gate 值大小寫/空白正規化（ANTHROPIC / 前後空白）視為開', () => {
    vi.stubEnv('AGENT_MODELS', 'analyst-tier1:claude-sonnet-4-6')
    vi.stubEnv('ANTHROPIC_API_KEY', 'k')
    vi.stubEnv('AI_PROVIDER', '  Anthropic  ')
    expect(resolveAgentModel('analyst-tier1')).toEqual({ provider: 'anthropic', model: 'claude-sonnet-4-6' })
  })

  it('gemini agent 不受 AI_PROVIDER 影響（narrative 仍 3.1-pro）', () => {
    vi.stubEnv('AI_PROVIDER', 'anthropic')
    vi.stubEnv('ANTHROPIC_API_KEY', 'k')
    expect(resolveAgentModel('narrative-writer')).toEqual({ provider: 'gemini', model: 'gemini-3.1-pro-preview' })
  })

  it('env AGENT_MODELS 條目兩側空白被 trim', () => {
    vi.stubEnv('AGENT_MODELS', ' editor : gemini-3.1-pro-preview ')
    expect(resolveAgentModel('editor')).toEqual({ provider: 'gemini', model: 'gemini-3.1-pro-preview' })
  })
  it('未知 agent → fallback model', () => {
    expect(resolveAgentModel('made-up-agent')).toEqual({ provider: 'gemini', model: 'gemini-3.5-flash' })
  })
})

describe('parseModelSpec', () => {
  it('★ 已知 provider 前綴才切開', () => {
    expect(parseModelSpec('openai/llama-3.3-70b')).toEqual({ provider: 'openai', model: 'llama-3.3-70b' })
    expect(parseModelSpec('gemini/gemini-3.7-flash')).toEqual({ provider: 'gemini', model: 'gemini-3.7-flash' })
    expect(parseModelSpec('anthropic/claude-sonnet-4-6')).toEqual({ provider: 'anthropic', model: 'claude-sonnet-4-6' })
  })
  it('★★ model 名本身含 `/` 但左半不是已知 provider → 整段都是 model（不誤切 meta-llama）', () => {
    expect(parseModelSpec('meta-llama/Llama-3.3-70B-Instruct')).toEqual({
      provider: undefined,
      model: 'meta-llama/Llama-3.3-70B-Instruct',
    })
  })
  it('裸 model（無 `/`）→ provider undefined', () => {
    expect(parseModelSpec('gemini-3.7-flash')).toEqual({ provider: undefined, model: 'gemini-3.7-flash' })
  })
  it('`/` 開頭（idx===0）不切', () => {
    expect(parseModelSpec('/weird-model')).toEqual({ provider: undefined, model: '/weird-model' })
  })
})

describe('defaultProviderFromEnv', () => {
  it('gemini/anthropic/openai（trim + 小寫）皆可辨識', () => {
    expect(defaultProviderFromEnv({ LLM_PROVIDER: 'openai' })).toBe('openai')
    expect(defaultProviderFromEnv({ LLM_PROVIDER: ' Anthropic ' })).toBe('anthropic')
    expect(defaultProviderFromEnv({ LLM_PROVIDER: 'GEMINI' })).toBe('gemini')
  })
  it('未設 → undefined、不警告', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(defaultProviderFromEnv({})).toBeUndefined()
    expect(warn).not.toHaveBeenCalled()
  })
  it('不合法值 → undefined + 警告一次', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(defaultProviderFromEnv({ LLM_PROVIDER: 'llama' })).toBeUndefined()
    expect(defaultProviderFromEnv({ LLM_PROVIDER: 'llama' })).toBeUndefined()
    expect(warn).toHaveBeenCalledTimes(1)
  })
})

describe('resolveAgentModel × 顯式 provider（openai / LLM_PROVIDER）', () => {
  it('用 AGENT_MODELS 顯式 openai/ 前綴 → openai，且 model 去掉前綴', () => {
    vi.stubEnv('AGENT_MODELS', 'decomposer:openai/llama-3.3-70b')
    expect(resolveAgentModel('decomposer')).toEqual({ provider: 'openai', model: 'llama-3.3-70b' })
  })
  it('用 OpenRouter 風格 model 名本身含 `/` 不被誤切成 provider', () => {
    vi.stubEnv('AGENT_MODELS', 'decomposer:openai/meta-llama/Llama-3.3-70B-Instruct')
    expect(resolveAgentModel('decomposer')).toEqual({ provider: 'openai', model: 'meta-llama/Llama-3.3-70B-Instruct' })
  })
  it('設 LLM_PROVIDER=openai 讓裸 model（無前綴）走 openai', () => {
    vi.stubEnv('LLM_PROVIDER', 'openai')
    expect(resolveAgentModel('decomposer')).toEqual({ provider: 'openai', model: 'gemini-3.7-flash' })
  })
  it('用 AGENT_MODELS 顯式前綴優先於 LLM_PROVIDER', () => {
    vi.stubEnv('LLM_PROVIDER', 'openai')
    vi.stubEnv('AGENT_MODELS', 'decomposer:gemini/gemini-3.7-flash')
    expect(resolveAgentModel('decomposer')).toEqual({ provider: 'gemini', model: 'gemini-3.7-flash' })
  })
  it('設 LLM_PROVIDER 不合法時警告並退回 legacy 啟發式（gemini）', () => {
    vi.stubEnv('LLM_PROVIDER', 'not-a-provider')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(resolveAgentModel('decomposer')).toEqual({ provider: 'gemini', model: 'gemini-3.7-flash' })
    expect(warn).toHaveBeenCalledTimes(1)
  })
  it('openai 沒有 silent fallback：即使沒有任何 anthropic/openai 金鑰設定，仍停在 openai（不像 anthropic 會退回 gemini）', () => {
    vi.stubEnv('AGENT_MODELS', 'analyst-tier1:openai/some-model')
    expect(resolveAgentModel('analyst-tier1')).toEqual({ provider: 'openai', model: 'some-model' })
  })
})
