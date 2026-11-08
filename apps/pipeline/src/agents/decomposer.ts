import type { LlmCallRecord } from './llm-wrapper.js'
import type { DecomposerOutput } from './types.js'
import { DECOMPOSER_SYSTEM_PROMPT } from '../prompts/decomposer.prompt.js'
import { DECOMPOSER_USER_TEXT } from '../prompts/decomposer.user-content.js'
import { callAgentLLM } from './llm-wrapper.js'
import { DecomposerOutputSchema } from './types.js'

const RESPONSE_GEMINI_SCHEMA = {
  type: 'object',
  properties: {
    primaryEntity: {
      type: 'object',
      properties: { name: { type: 'string' }, kind: { type: 'string' } },
      required: ['name', 'kind'],
    },
    topicTags: { type: 'array', items: { type: 'string' }, maxItems: 5 },
    cascadeHypotheses: {
      type: 'array',
      maxItems: 6,
      items: {
        type: 'object',
        properties: {
          industry: { type: 'string' },
          mechanism: { type: 'string' },
          retrieveQuery: {
            type: 'object',
            properties: {
              entities: { type: 'array', items: { type: 'string' } },
              topics: { type: 'array', items: { type: 'string' } },
              days: { type: 'integer' },
            },
          },
        },
        required: ['industry', 'mechanism', 'retrieveQuery'],
      },
    },
  },
  required: ['primaryEntity', 'topicTags', 'cascadeHypotheses'],
}

export interface CallDecomposerParams {
  newsTitle: string
  newsText: string
  newsId?: string
  onCallRecord?: (r: LlmCallRecord) => void
}

export async function callDecomposer(p: CallDecomposerParams): Promise<DecomposerOutput> {
  const userContent = DECOMPOSER_USER_TEXT.userContent(p.newsTitle, p.newsText)
  const raw = await callAgentLLM<unknown>({
    agentName: 'decomposer',
    systemPrompt: DECOMPOSER_SYSTEM_PROMPT,
    userContent,
    responseSchema: RESPONSE_GEMINI_SCHEMA,
    ...(p.newsId !== undefined ? { newsId: p.newsId } : {}),
    ...(p.onCallRecord !== undefined ? { onCallRecord: p.onCallRecord } : {}),
  })
  return DecomposerOutputSchema.parse(raw)
}
