import type { LlmCallRecord } from './call-agent.js'
import type { DecomposerOutput } from './types.js'
import { DECOMPOSER_SYSTEM_PROMPT } from '../prompts/decomposer.prompt.js'
import { DECOMPOSER_USER_TEXT } from '../prompts/decomposer.user-content.js'
import { callAgent } from './call-agent.js'
import { DecomposerResponse } from './response-schemas.js'
import { DecomposerOutputSchema } from './types.js'

export interface CallDecomposerParams {
  newsTitle: string
  newsText: string
  newsId?: string
  onCallRecord?: (r: LlmCallRecord) => void
}

export async function callDecomposer(p: CallDecomposerParams): Promise<DecomposerOutput> {
  const userContent = DECOMPOSER_USER_TEXT.userContent(p.newsTitle, p.newsText)
  const raw = await callAgent('decomposer', { systemPrompt: DECOMPOSER_SYSTEM_PROMPT, userContent }, DecomposerResponse, {
    ...(p.newsId !== undefined ? { newsId: p.newsId } : {}),
    ...(p.onCallRecord !== undefined ? { onCallRecord: p.onCallRecord } : {}),
  })
  // Anthropic 的 structured output 不強制 maxItems，超量時截斷，不讓整則新聞失敗。
  return DecomposerOutputSchema.parse({
    ...raw,
    topicTags: raw.topicTags.slice(0, 5),
    cascadeHypotheses: raw.cascadeHypotheses.slice(0, 6),
  })
}
