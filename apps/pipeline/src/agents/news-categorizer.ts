import { ITEM_CATEGORIES } from '@suanomics/db/news-categories'
import { NEWS_CATEGORIZER_SYSTEM_PROMPT } from '../prompts/news-categorizer.prompt.js'
import { callAgentLLM } from './llm-wrapper.js'
import { clampString } from './narrative-shared.js'

export interface CategorizerItem { id: number, title: string, excerpt: string }
export interface CategorizedItem { id: number, category: string }

const RESPONSE_GEMINI_SCHEMA = {
  type: 'object',
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          category: { type: 'string', enum: [...ITEM_CATEGORIES] },
        },
        required: ['id', 'category'],
      },
    },
  },
  required: ['results'],
}

// 不信任 LLM：只留 id 在輸入集、category 合法的；重複 id 取第一筆。
export function normalizeCategorizerResponse(raw: unknown, inputIds: readonly number[]): CategorizedItem[] {
  if (!raw || typeof raw !== 'object')
    return []
  const results = (raw as { results?: unknown }).results
  if (!Array.isArray(results))
    return []
  const allowed = new Set(inputIds)
  const validCats = new Set<string>(ITEM_CATEGORIES)
  const seen = new Set<number>()
  const out: CategorizedItem[] = []
  for (const r of results) {
    if (!r || typeof r !== 'object')
      continue
    const { id, category } = r as { id?: unknown, category?: unknown }
    if (typeof id !== 'number' || typeof category !== 'string')
      continue
    if (!allowed.has(id) || seen.has(id) || !validCats.has(category))
      continue
    seen.add(id)
    out.push({ id, category })
  }
  return out
}

export async function callNewsCategorizer(items: readonly CategorizerItem[]): Promise<CategorizedItem[]> {
  if (items.length === 0)
    return []
  const userContent = items
    .map(i => `[id=${i.id}] ${clampString(i.title, 120)} — ${clampString(i.excerpt, 150)}`)
    .join('\n')
  const raw = await callAgentLLM<unknown>({
    agentName: 'news-categorizer',
    systemPrompt: NEWS_CATEGORIZER_SYSTEM_PROMPT,
    userContent,
    responseSchema: RESPONSE_GEMINI_SCHEMA,
  })
  return normalizeCategorizerResponse(raw, items.map(i => i.id))
}
