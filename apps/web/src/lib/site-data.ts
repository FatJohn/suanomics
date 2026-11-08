import type { NewsRow, SiteRows } from './db/site-repo'
import type { BriefView } from './present-brief'
import process from 'node:process'
import { readSiteRows } from './db/site-repo'
import { parseBriefJson, presentBrief } from './present-brief'

export interface SiteData { briefs: BriefView[], news: NewsRow[] }

async function readRows(): Promise<SiteRows> {
  const url = process.env.WEB_DATABASE_URL
  if (url)
    return readSiteRows(url)
  // fresh clone 與 CI 的 pnpm -r build 沒有資料庫可讀，仍要能 build。
  console.warn('[web] WEB_DATABASE_URL 未設定：產出沒有 brief 的空站')
  return { briefs: [], news: [] }
}

async function load(): Promise<SiteData> {
  const { briefs, news } = await readRows()
  const newsById = new Map(news.map(n => [n.id, n]))
  return {
    briefs: briefs.map(b => presentBrief(
      b.briefDate,
      parseBriefJson(b.briefDate, b.briefJson),
      b.selectedNewsIds.flatMap((id) => {
        const item = newsById.get(id)
        return item ? [{ id, title: item.title }] : []
      }),
    )),
    news,
  }
}

let cached: Promise<SiteData> | undefined

// 每個頁面的 getStaticPaths 共用同一次查詢。
export function getSiteData(): Promise<SiteData> {
  cached ??= load()
  return cached
}
