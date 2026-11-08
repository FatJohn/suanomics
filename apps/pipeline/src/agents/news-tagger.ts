import { NEWS_TAGGER_SYSTEM_PROMPT } from '../prompts/news-tagger.prompt.js'
import { callAgentLLM } from './llm-wrapper.js'
import { clampString } from './narrative-shared.js'

export interface TaggerItem { id: number, title: string, excerpt: string }
export interface TaggedItem { id: number, tags: string[] }

const MAX_TAGS = 6

const RESPONSE_GEMINI_SCHEMA = {
  type: 'object',
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          tags: { type: 'array', items: { type: 'string' } },
        },
        required: ['id', 'tags'],
      },
    },
  },
  required: ['results'],
}

// 不信任 LLM：只留 input 集內 id、tags 轉小寫去空去重切上限；重複 id 取第一筆。
export function normalizeTaggerResponse(raw: unknown, inputIds: readonly number[]): TaggedItem[] {
  if (!raw || typeof raw !== 'object')
    return []
  const results = (raw as { results?: unknown }).results
  if (!Array.isArray(results))
    return []
  const allowed = new Set(inputIds)
  const seen = new Set<number>()
  const out: TaggedItem[] = []
  for (const r of results) {
    if (!r || typeof r !== 'object')
      continue
    const { id, tags } = r as { id?: unknown, tags?: unknown }
    if (typeof id !== 'number' || !Number.isInteger(id))
      continue
    if (!allowed.has(id) || seen.has(id))
      continue
    if (!Array.isArray(tags))
      continue
    const clean = [...new Set(
      tags
        .filter((t): t is string => typeof t === 'string')
        .map(t => t.trim().toLowerCase())
        .filter(t => t.length > 0),
    )].slice(0, MAX_TAGS)
    seen.add(id)
    out.push({ id, tags: clean })
  }
  return out
}

export async function callNewsTagger(items: readonly TaggerItem[]): Promise<TaggedItem[]> {
  if (items.length === 0)
    return []
  const userContent = items
    .map(i => `[id=${i.id}] ${clampString(i.title, 120)} — ${clampString(i.excerpt, 150)}`)
    .join('\n')
  const raw = await callAgentLLM<unknown>({
    agentName: 'news-tagger',
    systemPrompt: NEWS_TAGGER_SYSTEM_PROMPT,
    userContent,
    responseSchema: RESPONSE_GEMINI_SCHEMA,
  })
  return normalizeTaggerResponse(raw, items.map(i => i.id))
}
