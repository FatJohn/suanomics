import { describe, expect, it } from 'vitest'
import { AGENT_NAMES, resolveAgentModel } from './models.js'

const HAIKU = { provider: 'anthropic', model: 'claude-haiku-5-5' }
const SONNET = { provider: 'anthropic', model: 'claude-sonnet-5-5' }

describe('resolveAgentModel 預設值', () => {
  it.each([
    ['news-categorizer', HAIKU],
    ['news-tagger', HAIKU],
    ['chain-grouper', HAIKU],
    ['corpus-entity-summary', HAIKU],
    ['decomposer', SONNET],
    ['analyst-tier1', SONNET],
    ['analyst-tier2', SONNET],
    ['synthesizer', SONNET],
    ['editor', SONNET],
    ['viewpoints-debate', SONNET],
    ['narrative-writer', SONNET],
    ['podcast-writer', SONNET],
    ['brief-judge', SONNET],
    ['brief-quality-judge', SONNET],
    ['brief-continuity-judge', SONNET],
  ] as const)('%s', (agent, expected) => {
    expect(resolveAgentModel(agent, {})).toEqual(expected)
  })

  it('15 個 agent 全部列在表上', () => {
    expect(AGENT_NAMES).toHaveLength(15)
  })
})

describe('resolveAgentModel 的 AGENT_MODELS 覆寫', () => {
  it('只覆寫被點名的 agent，其他維持預設', () => {
    const env = { AGENT_MODELS: 'news-tagger:anthropic/claude-sonnet-5-5, editor:anthropic/claude-haiku-5-5' }
    expect(resolveAgentModel('news-tagger', env)).toEqual(SONNET)
    expect(resolveAgentModel('editor', env)).toEqual(HAIKU)
    expect(resolveAgentModel('decomposer', env)).toEqual(SONNET)
  })

  it('空字串等同沒有覆寫', () => {
    expect(resolveAgentModel('news-tagger', { AGENT_MODELS: '' })).toEqual(HAIKU)
  })

  it('aGENT_MODELS 含未知 agent 名稱時拒絕，即使查的是別的 agent', () => {
    expect(() => resolveAgentModel('news-tagger', { AGENT_MODELS: 'no-such-agent:anthropic/claude-haiku-5-5' }))
      .toThrow(/no-such-agent/)
  })

  it.each([
    'news-tagger',
    'news-tagger:claude-haiku-5-5',
    'news-tagger:openai/gpt-5',
    'news-tagger:google/gemini-3.5-flash',
    'news-tagger:anthropic/',
  ])('格式錯誤或 provider 不支援時拒絕：%s', (raw) => {
    expect(() => resolveAgentModel('news-tagger', { AGENT_MODELS: raw })).toThrow(/AGENT_MODELS/)
  })
})

describe('resolveAgentModel 的呼叫端名稱', () => {
  it('未知 agent 名稱拒絕', () => {
    expect(() => resolveAgentModel('no-such-agent' as never, {})).toThrow(/no-such-agent/)
  })
})
