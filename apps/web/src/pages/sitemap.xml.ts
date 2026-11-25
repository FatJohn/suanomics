import type { APIRoute } from 'astro'
import { absoluteUrl, sitemapXml } from '../lib/seo'
import { getSiteData } from '../lib/site-data'

// 新聞頁只有標題與外連，不列進 sitemap，讓爬蟲把額度花在講義頁。
export const GET: APIRoute = async ({ site }) => {
  const origin = site?.href ?? 'https://suanomics.everbegin.net'
  const { briefs } = await getSiteData()
  const latest = briefs[0]?.date
  const xml = sitemapXml([
    { loc: absoluteUrl('/', origin), ...(latest && { lastmod: latest }) },
    { loc: absoluteUrl('/dates', origin), ...(latest && { lastmod: latest }) },
    ...briefs.map(b => ({ loc: absoluteUrl(`/d/${b.date}`, origin), lastmod: b.date })),
  ])
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } })
}
