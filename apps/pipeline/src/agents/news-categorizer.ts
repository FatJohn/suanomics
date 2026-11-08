import { ITEM_CATEGORIES } from '../db/news-categories.js'
import { NEWS_CATEGORIZER_SYSTEM_PROMPT } from '../prompts/news-categorizer.prompt.js'
import { callAgent } from './call-agent.js'
import { clampString } from './narrative-shared.js'
import { NewsCategorizerResponse } from './response-schemas.js'

export interface CategorizerItem { id: number, title: string, excerpt: string }
export interface CategorizedItem { id: number, category: string }

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
  const raw = await callAgent('news-categorizer', { systemPrompt: NEWS_CATEGORIZER_SYSTEM_PROMPT, userContent }, NewsCategorizerResponse)
  return normalizeCategorizerResponse(raw, items.map(i => i.id))
}
