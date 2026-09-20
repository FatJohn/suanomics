import { updateNewsItemTopicTags } from '@suanomics/db/repos/news-repo'
import { callNewsTagger } from '../agents/news-tagger.js'

export const BATCH_SIZE = 15

export interface TaggableNewsItem { id: number, title: string, contentText: string | null }

// 批次標 topic_tags、寫回 news_items。標題 + excerpt 足以標（不需全文）。
// 中途某批 throw 會整包丟（不寫任何 tag）、由上層 refresh 吞掉、items 留 taggedAt=null 之後補。
// 所有「成功這次」的 input item 都會被寫（LLM 沒回的 → []）、確保 taggedAt 設上、idempotent。
export async function tagAndStore(items: readonly TaggableNewsItem[]): Promise<void> {
  if (items.length === 0)
    return
  const tagsById = new Map<number, string[]>()
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE)
    const result = await callNewsTagger(batch.map(b => ({ id: b.id, title: b.title, excerpt: b.contentText ?? '' })))
    for (const r of result)
      tagsById.set(r.id, r.tags)
  }
  const updates = items.map(it => ({ id: it.id, topicTags: tagsById.get(it.id) ?? [] }))
  await updateNewsItemTopicTags(updates)
}
