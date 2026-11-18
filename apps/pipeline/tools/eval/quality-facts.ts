import type { QualitySourceNews } from './quality-judge.prompt.js'

interface FactNewsItem { id: number, title: string, url: string, contentText: string | null }

/** 事實底本的新聞段：選用與引用的 news_items。 */
export function mergeQualitySources(newsItems: readonly FactNewsItem[]): QualitySourceNews[] {
  const byId = new Map(newsItems.map(n => [n.id, { title: n.title, url: n.url, text: n.contentText ?? n.title }]))
  return [...byId.values()]
}
