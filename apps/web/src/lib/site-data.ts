import type { NewsRow, SiteRows } from './db/site-repo'
import type { BriefNews, BriefView } from './present-brief'
import process from 'node:process'
import { readSiteRows } from './db/site-repo'
import { parseBriefJson, presentBrief } from './present-brief'

export interface SiteData { briefs: BriefView[], news: NewsRow[] }

// fresh clone 與 CI 的 pnpm -r build 沒有資料庫可讀，仍要能 build；
// 部署走 build:publish，少了連線字串要失敗，否則空站會蓋掉線上。
export function resolveDatabaseUrl(env: Record<string, string | undefined>): string | null {
  if (env.WEB_DATABASE_URL)
    return env.WEB_DATABASE_URL
  if (env.WEB_REQUIRE_DATABASE)
    throw new Error('部署用的 build 需要 WEB_DATABASE_URL')
  return null
}

async function readRows(): Promise<SiteRows> {
  const url = resolveDatabaseUrl(process.env)
  if (url)
    return readSiteRows(url)
  console.warn('[web] WEB_DATABASE_URL 未設定：產出沒有 brief 的空站')
  return { briefs: [], news: [], citedNews: [] }
}

async function load(): Promise<SiteData> {
  const { briefs, news, citedNews } = await readRows()
  const newsById = new Map(news.map(n => [n.id, n]))
  const citedByUrl = Map.groupBy(citedNews, n => n.url)
  return {
    briefs: briefs.map((b) => {
      const brief = parseBriefJson(b.briefDate, b.briefJson)
      const briefNews: BriefNews[] = [
        ...b.selectedNewsIds.flatMap((id) => {
          const item = newsById.get(id)
          return item ? [{ ...item, selected: true }] : []
        }),
        ...brief.citations.flatMap(c => (citedByUrl.get(c.url) ?? []).slice(0, 1).map(n => ({ ...n, selected: false }))),
      ]
      return presentBrief(b.briefDate, brief, briefNews, b.audioUrl)
    }),
    news,
  }
}

let cached: Promise<SiteData> | undefined

// 每個頁面的 getStaticPaths 共用同一次查詢。
export function getSiteData(): Promise<SiteData> {
  cached ??= load()
  return cached
}
