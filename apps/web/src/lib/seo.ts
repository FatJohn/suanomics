export const DEFAULT_DESCRIPTION = '每個台股交易日開盤前的總經重點講義：前一晚世界發生了什麼、透過什麼機制牽動哪些台股、方向為何，每條連動鏈附引用來源。'

// Google 搜尋結果的中文摘要大約顯示 100 字上下，超過的部分會被截掉。
const DESCRIPTION_MAX = 100

// Cloudflare Pages 對 /dates 回 308 轉到 /dates/；canonical 與 og:url 直接給最終網址，
// 爬蟲與社群平台才不用多跟一次轉址。
export function absoluteUrl(path: string, site: string): string {
  const url = new URL(path, site)
  const lastSegment = url.pathname.split('/').pop() ?? ''
  if (!url.pathname.endsWith('/') && !lastSegment.includes('.'))
    url.pathname += '/'
  return url.href
}

// 以 code point 計數，截斷時不會切開罕用字的 surrogate pair。
export function metaDescription(text: string | undefined, max = DESCRIPTION_MAX): string {
  const chars = Array.from((text ?? '').replace(/\s+/g, ' ').trim())
  if (chars.length === 0)
    return DEFAULT_DESCRIPTION
  return chars.length <= max ? chars.join('') : `${chars.slice(0, max - 1).join('')}…`
}

export interface SitemapEntry { loc: string, lastmod?: string }

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function sitemapXml(entries: readonly SitemapEntry[]): string {
  const urls = entries.map(({ loc, lastmod }) =>
    `<url><loc>${escapeXml(loc)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</url>`)
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    '</urlset>',
    '',
  ].join('\n')
}
