import type { ExternalArticleByUrl } from '../../src/db/repos/articles-repo.js'
import type { QualitySourceNews } from './quality-judge.prompt.js'

interface FactNewsItem { id: number, title: string, url: string, contentText: string | null }

/** 事實底本的新聞段：選用與引用的 news_items，加上連動鏈引用到的 corpus 文章。 */
export function mergeQualitySources(newsItems: readonly FactNewsItem[], corpus: readonly ExternalArticleByUrl[]): QualitySourceNews[] {
  const byId = new Map(newsItems.map(n => [n.id, { title: n.title, url: n.url, text: n.contentText ?? n.title }]))
  const out = [...byId.values()]
  const urls = new Set(out.map(n => n.url))
  for (const a of corpus) {
    if (urls.has(a.url))
      continue
    urls.add(a.url)
    out.push({ title: a.title, url: a.url, text: a.text })
  }
  return out
}
