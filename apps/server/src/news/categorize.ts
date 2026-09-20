import { updateNewsItemCategories } from '@suanomics/db/repos/news-repo'
import { callNewsCategorizer } from '../agents/news-categorizer.js'

export const BATCH_SIZE = 15

export interface CategorizableNewsItem { id: number, title: string, contentText: string | null }

// 批次分類新進 items、寫回 news_items.category。標題 + excerpt 足以分類（不需 scrape 全文）。
// 中途某批 throw 會整包丟（不寫任何 category）、由上層 refresh 吞掉、items 留 null 退來源層——
// 可接受：非延遲敏感、bounded、之後重新分類即可補。
export async function categorizeAndStore(items: readonly CategorizableNewsItem[]): Promise<void> {
  if (items.length === 0)
    return
  const all: { id: number, category: string }[] = []
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE)
    const result = await callNewsCategorizer(batch.map(b => ({ id: b.id, title: b.title, excerpt: b.contentText ?? '' })))
    all.push(...result)
  }
  await updateNewsItemCategories(all)
}
