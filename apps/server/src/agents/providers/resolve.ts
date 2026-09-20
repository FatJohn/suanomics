import process from 'node:process'

export type LlmProvider = 'gemini' | 'anthropic' | 'openai'

const KNOWN_PROVIDERS: readonly LlmProvider[] = ['gemini', 'anthropic', 'openai']

export interface ModelSpec {
  provider: LlmProvider | undefined
  model: string
}

// 解析 `provider/model` 或裸 model。★只有第一個 `/` 左邊剛好是已知 provider 名時才切開，
// 否則整個字串都是 model——OpenRouter／HuggingFace 風格的 model 名本身就含 `/`
// （例如 `meta-llama/Llama-3.3-70B-Instruct`），寫死「有 `/` 就切」會把 `meta-llama`
// 誤判成 provider。
export function parseModelSpec(spec: string): ModelSpec {
  const idx = spec.indexOf('/')
  if (idx > 0) {
    const maybeProvider = spec.slice(0, idx)
    if ((KNOWN_PROVIDERS as readonly string[]).includes(maybeProvider))
      return { provider: maybeProvider as LlmProvider, model: spec.slice(idx + 1) }
  }
  return { provider: undefined, model: spec }
}

export type AgentName
  = | 'decomposer'
    | 'analyst-tier1'
    | 'analyst-tier2'
    | 'synthesizer'
    | 'editor'
    | 'narrative-writer'
    | 'podcast-writer'
    | 'brief-judge'
    | 'brief-quality-judge'
    | 'news-categorizer'
    | 'news-tagger'
    | 'brief-continuity-judge'
    | 'viewpoints-debate'
    | 'chain-grouper'
    | 'corpus-entity-summary'

// 每個 agent 的預設 model（建議值、version-controlled）。env AGENT_MODELS 可逐 agent override。
// narrative-writer 升 gemini-3.1-pro-preview（A/B 證實報告品質明顯較好）。
// news-categorizer / news-tagger / chain-grouper / corpus-entity-summary 走 gemini-3.5-flash-lite：
// 這四個是「分類 / 抽標籤 / 摘要」的低複雜度高量路徑（entity-summary 一天約 432 calls），
// 輸出是短 JSON 且有 responseSchema 約束，用 flash 的推理餘裕換不到品質、只換到 5 倍價（2026-08-02）。
//
// 2026-08-23：主推理層六個 agent 從 gemini-3.5-flash 換到 gemini-3.7-flash。
// 三個要點：
//   1. **理由不是 3.7 比較好，是品質量不出差異而折扣期內便宜一半。** viewpoints-debate 的
//      A/B：跨臂非 tie 率 23.8% 低於同臂雜訊底線 28.6%、勝負 5-4。
//   2. **折扣 2026-12-31 到期**，之後 3.7 與 3.5-flash 的 input 同價（$1.50），整體只剩約 −7%。
//      那時不必換回來，但也別再拿「省錢」當理由。到期由 pricing.ts 的 time-bomb 提醒。
//   3. **六個裡只有 viewpoints-debate 實測過**，另外五個靠的是可逆性不是證據
//      （env AGENT_MODELS 一行可退、不必部署）。analyst-tier1 佔這六個成本的一半、
//      產結構化 claim 接 grounding 與合規，它沒有 model:ab target——要真的驗它得先寫一個。
//
// ★ 三個 judge **刻意留在 3.5-flash**：它們是量尺本身。換掉量尺會讓
//   品質趨勢日誌的歷史列不可比，而且改 judge model 有它自己的程序。
// ★ podcast-writer 留在 gemini-3-flash-preview（$0.50/$3.00）：換 3.7 兩側都是漲價。
export const AGENT_MODEL_DEFAULTS: Record<AgentName, string> = {
  'decomposer': 'gemini-3.7-flash',
  'analyst-tier1': 'gemini-3.7-flash',
  'analyst-tier2': 'gemini-3.7-flash',
  'synthesizer': 'gemini-3.7-flash',
  'editor': 'gemini-3.7-flash',
  'narrative-writer': 'gemini-3.1-pro-preview',
  'podcast-writer': 'gemini-3-flash-preview',
  'brief-judge': 'gemini-3.5-flash',
  'brief-quality-judge': 'gemini-3.5-flash',
  'brief-continuity-judge': 'gemini-3.5-flash',
  'news-categorizer': 'gemini-3.5-flash-lite',
  'news-tagger': 'gemini-3.5-flash-lite',
  'viewpoints-debate': 'gemini-3.7-flash',
  'chain-grouper': 'gemini-3.5-flash-lite',
  'corpus-entity-summary': 'gemini-3.5-flash-lite',
}

const FALLBACK_MODEL = 'gemini-3.5-flash'

export function providerForModel(model: string): LlmProvider {
  return model.startsWith('claude') ? 'anthropic' : 'gemini'
}

const warned = new Set<string>()
export function resetProviderWarnCache(): void {
  warned.clear()
}

// 全域預設 provider（env LLM_PROVIDER）。給沒有顯式 provider 前綴的 model 當退路，
// 主要服務自架／OpenRouter 使用者：不必逐 agent 寫 `openai/` 前綴，設一次全域即可。
// 值不合法（非 gemini/anthropic/openai）時警告一次並回 undefined、不擋起來。
export function defaultProviderFromEnv(env: NodeJS.ProcessEnv = process.env): LlmProvider | undefined {
  const raw = (env.LLM_PROVIDER ?? '').trim().toLowerCase()
  if (!raw)
    return undefined
  if ((KNOWN_PROVIDERS as readonly string[]).includes(raw))
    return raw as LlmProvider
  const warnKey = `LLM_PROVIDER:${raw}`
  if (!warned.has(warnKey)) {
    warned.add(warnKey)
    console.warn(`[llm-wrapper] unknown LLM_PROVIDER "${raw}", ignoring (expected one of gemini/anthropic/openai)`)
  }
  return undefined
}

// env AGENT_MODELS：'agent:model,agent:model' → Map
function parseAgentModelsEnv(): Map<string, string> {
  const raw = process.env.AGENT_MODELS ?? ''
  const m = new Map<string, string>()
  for (const pair of raw.split(',').map(s => s.trim()).filter(Boolean)) {
    const idx = pair.indexOf(':')
    if (idx <= 0)
      continue
    const agent = pair.slice(0, idx).trim()
    const model = pair.slice(idx + 1).trim()
    if (agent && model)
      m.set(agent, model)
  }
  return m
}

// 每個 agent 解析 { provider, model }：
// 1. env AGENT_MODELS override > AGENT_MODEL_DEFAULTS > FALLBACK_MODEL
// 2. provider 解析順序：
//    a. AGENT_MODELS 值裡的顯式 `provider/model` 前綴
//    b. 全域 env LLM_PROVIDER
//    c. legacy 啟發式：model 以 claude 開頭 → anthropic（向後相容，見 providerForModel）
//    d. 其餘一律 gemini
// 3. anthropic 須同時滿足三條件才真的走：AI_PROVIDER=anthropic（正規化）+ ANTHROPIC_API_KEY 存在 + claude* model
//    預設（未設/gemini/拼錯）一律關 → zero Claude 花費，即使 key 在。**openai 沒有這種 silent
//    fallback**：對自架使用者來說 openai 通常就是唯一的 provider，悄悄換回 gemini 是錯的
//    降級（他很可能根本沒有 GEMINI_API_KEY）；openai key 缺失交給 adapter 呼叫時 throw、
//    以及啟動檢查（packages/shared/src/startup-config.ts）在開機時擋。
export function resolveAgentModel(agentName: string): { provider: LlmProvider, model: string } {
  const override = parseAgentModelsEnv().get(agentName)
  const rawModel = override ?? AGENT_MODEL_DEFAULTS[agentName as AgentName] ?? FALLBACK_MODEL
  const spec = parseModelSpec(rawModel)
  const model = spec.model
  const provider: LlmProvider = spec.provider ?? defaultProviderFromEnv() ?? providerForModel(model)
  if (provider === 'anthropic') {
    // 總開關 gate：唯有 AI_PROVIDER=anthropic（正規化）+ key 存在才真的走 Anthropic。
    // 預設（未設/gemini/拼錯）一律關 → claude* fallback gemini，即使 key 在也零 Claude 花費。
    const gateOn = (process.env.AI_PROVIDER ?? '').trim().toLowerCase() === 'anthropic'
    if (!gateOn || !process.env.ANTHROPIC_API_KEY) {
      if (!warned.has(agentName)) {
        warned.add(agentName)
        const reason = !gateOn ? 'AI_PROVIDER 未開' : 'ANTHROPIC_API_KEY missing'
        // console.error 而不是 warn：這是一次無聲的 provider 抽換，帳單與品質都變了。
        // 同一件事在啟動時也會被 checkStartupConfig 抓到（缺金鑰那條是 fatal），
        // 這行是給「跑到一半才第一次解析到這個 agent」的情況留的最後一道聲音。
        console.error(`[llm-wrapper] SILENT FALLBACK: agent ${agentName} configured for ${model} but ${reason}, falling back to ${FALLBACK_MODEL}`)
      }
      return { provider: 'gemini', model: FALLBACK_MODEL }
    }
  }
  return { provider, model }
}
