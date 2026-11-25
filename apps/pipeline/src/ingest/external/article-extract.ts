import { Readability } from '@mozilla/readability'
import { load } from 'cheerio'
import { parseHTML } from 'linkedom'
import { extractArticleText } from './scraper.js'

const MIN_READABLE_LENGTH = 30

function paragraphsOf(contentHtml: string): string {
  const $ = load(contentHtml)
  return $('p, li')
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(t => t.length > 0)
    .join('\n')
}

/** Readability 抽文章本體；判不出文章的頁面（短公告、非標準版面）退回段落抽取。 */
export function extractReadableText(html: string): string | null {
  const { document } = parseHTML(html)
  const article = new Readability(document as unknown as Document).parse()
  const text = article?.content ? paragraphsOf(article.content) : ''
  return text.length >= MIN_READABLE_LENGTH ? text : extractArticleText(html)
}
