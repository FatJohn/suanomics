import process from 'node:process'

export const AGENT_NAMES = [
  'news-categorizer',
  'news-tagger',
  'chain-grouper',
  'corpus-entity-summary',
  'decomposer',
  'analyst-tier1',
  'analyst-tier2',
  'synthesizer',
  'editor',
  'viewpoints-debate',
  'narrative-writer',
  'podcast-writer',
  'brief-judge',
  'brief-quality-judge',
  'brief-continuity-judge',
] as const
export type AgentName = (typeof AGENT_NAMES)[number]

const PROVIDERS = ['anthropic'] as const
export type LlmProvider = (typeof PROVIDERS)[number]

export interface AgentModel {
  provider: LlmProvider
  model: string
}

const HAIKU = 'anthropic/claude-haiku-5-5'
const SONNET = 'anthropic/claude-sonnet-5-5'

const AGENT_MODEL_DEFAULTS: Record<AgentName, string> = {
  'news-categorizer': HAIKU,
  'news-tagger': HAIKU,
  'chain-grouper': HAIKU,
  'corpus-entity-summary': HAIKU,
  'decomposer': SONNET,
  'analyst-tier1': SONNET,
  'analyst-tier2': SONNET,
  'synthesizer': SONNET,
  'editor': SONNET,
  'viewpoints-debate': SONNET,
  'narrative-writer': SONNET,
  'podcast-writer': SONNET,
  'brief-judge': SONNET,
  'brief-quality-judge': SONNET,
  'brief-continuity-judge': SONNET,
}

function isAgentName(value: string): value is AgentName {
  return (AGENT_NAMES as readonly string[]).includes(value)
}

function isProvider(value: string): value is LlmProvider {
  return (PROVIDERS as readonly string[]).includes(value)
}

function parseModelSpec(spec: string): AgentModel | null {
  const slash = spec.indexOf('/')
  const provider = spec.slice(0, slash)
  const model = spec.slice(slash + 1)
  return slash > 0 && model !== '' && isProvider(provider) ? { provider, model } : null
}

// 整串一起驗：打錯的 agent 名稱若只在查到它時才報錯，等於那筆覆寫靜默失效。
function parseAgentModelOverrides(raw: string | undefined): Map<AgentName, AgentModel> {
  const overrides = new Map<AgentName, AgentModel>()
  for (const entry of (raw ?? '').split(',').map(s => s.trim()).filter(Boolean)) {
    const colon = entry.indexOf(':')
    const name = entry.slice(0, colon)
    if (colon <= 0)
      throw new Error(`AGENT_MODELS 格式應為 agent:provider/model，收到 ${entry}`)
    if (!isAgentName(name))
      throw new Error(`AGENT_MODELS 含未知 agent：${name}`)
    const model = parseModelSpec(entry.slice(colon + 1))
    if (model === null)
      throw new Error(`AGENT_MODELS 的 model 應為 provider/model 且 provider 限 ${PROVIDERS.join('、')}，收到 ${entry}`)
    overrides.set(name, model)
  }
  return overrides
}

export function resolveAgentModel(
  name: AgentName,
  env: Record<string, string | undefined> = process.env,
): AgentModel {
  if (!isAgentName(name))
    throw new Error(`未知 agent：${String(name)}`)
  const override = parseAgentModelOverrides(env.AGENT_MODELS).get(name)
  if (override)
    return override
  const parsed = parseModelSpec(AGENT_MODEL_DEFAULTS[name])
  if (parsed === null)
    throw new Error(`預設 model 設定錯誤：${name}`)
  return parsed
}
