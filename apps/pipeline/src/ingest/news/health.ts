import { isGoogleNewsProxySeed } from '@suanomics/db/seed'
import { hasBodyBeyondTitle } from '@suanomics/shared'

/** 一列 `news_sources`（DB 現況，不是 SEED——兩者可能不一致，而不一致本身就是要看的東西）。 */
export interface HealthSourceInput {
  slug: string
  displayName: string
  rssUrl: string
  isActive: boolean
  /** 有史以來的則數（不限窗），用來分辨「從來沒抓到過」與「以前有、最近沒有」。 */
  totalItems: number
}

/** 判定窗內的一則 `news_items`（只取判定要用的欄位）。 */
export interface HealthItemInput {
  slug: string
  title: string
  contentText: string | null
  contentSource: string
  publishedAt: Date | null
}

export interface NewsHealthRaw {
  sources: readonly HealthSourceInput[]
  items: readonly HealthItemInput[]
}

/**
 * 三種「看起來健康其實是壞的」，加上一種「明著壞」。
 *
 * - `silent`：啟用中、窗內零則。明著壞。
 * - `title-only`：窗內有則數，但一則都沒有超出標題（Google News 代理的錨點 markup、
 *   或 udn 那種 item 全空的空殼端點）。**HTTP 200 且 content_text 非空**。
 * - `no-scrape`：窗內有則數，但沒有任何一則的 `content_source` 是 `scrape`——
 *   RSS 進得來、正文一篇都沒抓到。這正是 DoD 判準。
 * - `zombie`：抓得到東西，但最新一則的 pubDate 已經過期太久。★ 這個失敗模式的實例是
 *   2026-08-28 探測**候選**直連 feed 時撞到的——`feeds.a.dj.com`（停更 19 個月）與
 *   `www.csis.org/rss.xml`（停更 10 年），兩者都是 200 且 description 有真正文。
 *   **那兩個不是 news_sources 裡的 slug**（現行的 `wsj-markets` 走 Google News 代理、
 *   staleness 是 0），別把註解讀成「這兩個來源現在是殭屍」。
 */
export type NewsHealthFlag = 'silent' | 'title-only' | 'no-scrape' | 'zombie'

export interface SourceHealth {
  slug: string
  displayName: string
  isActive: boolean
  /** feed 是不是 Google News 代理——代理的 `content_text` 天生只有標題，判準要據此讀。 */
  isProxy: boolean
  totalItems: number
  inWindow: number
  /** 窗內「超出標題」的則數（`hasBodyBeyondTitle`，與 SLO 端點同一支函式）。 */
  usable: number
  byContentSource: Record<string, number>
  bodyLenP50: number
  bodyLenP90: number
  latestPublishedAt: Date | null
  /** now 減最新 pubDate 的天數；窗內沒有任何 pubDate 時是 null（沒量到 ≠ 壞了）。 */
  stalenessDays: number | null
  flags: NewsHealthFlag[]
}

export interface SummarizeOptions {
  /** 最新 pubDate 超過這個天數就判 zombie。預設 14 天：日報來源沒有一個是雙週刊。 */
  zombieAfterDays?: number
}

const DEFAULT_ZOMBIE_AFTER_DAYS = 14
const MS_PER_DAY = 86_400_000

/** nearest-rank 百分位。空陣列回 0（沒有資料就是沒有長度，不是 NaN）。 */
function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0)
    return 0
  const rank = Math.ceil((p / 100) * sorted.length)
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1] ?? 0
}

export function summarizeNewsHealth(
  raw: NewsHealthRaw,
  now: Date,
  opts: SummarizeOptions = {},
): SourceHealth[] {
  const zombieAfterDays = opts.zombieAfterDays ?? DEFAULT_ZOMBIE_AFTER_DAYS
  const bySlug = new Map<string, HealthItemInput[]>()
  for (const it of raw.items) {
    const bucket = bySlug.get(it.slug)
    if (bucket === undefined)
      bySlug.set(it.slug, [it])
    else bucket.push(it)
  }

  return [...raw.sources]
    .sort((a, b) => a.slug.localeCompare(b.slug))
    .map((src) => {
      const items = bySlug.get(src.slug) ?? []
      const byContentSource: Record<string, number> = {}
      let usable = 0
      let latest: Date | null = null
      const lens: number[] = []
      for (const it of items) {
        byContentSource[it.contentSource] = (byContentSource[it.contentSource] ?? 0) + 1
        if (hasBodyBeyondTitle(it.title, it.contentText))
          usable += 1
        lens.push(it.contentText?.length ?? 0)
        if (it.publishedAt !== null && (latest === null || it.publishedAt > latest))
          latest = it.publishedAt
      }
      lens.sort((a, b) => a - b)
      const stalenessDays = latest === null
        ? null
        : Math.floor((now.getTime() - (latest as Date).getTime()) / MS_PER_DAY)

      const flags: NewsHealthFlag[] = []
      if (src.isActive && items.length === 0)
        flags.push('silent')
      if (items.length > 0) {
        if (usable === 0)
          flags.push('title-only')
        if ((byContentSource.scrape ?? 0) === 0)
          flags.push('no-scrape')
        if (stalenessDays !== null && stalenessDays > zombieAfterDays)
          flags.push('zombie')
      }

      return {
        slug: src.slug,
        displayName: src.displayName,
        isActive: src.isActive,
        isProxy: isGoogleNewsProxySeed(src),
        totalItems: src.totalItems,
        inWindow: items.length,
        usable,
        byContentSource,
        bodyLenP50: percentile(lens, 50),
        bodyLenP90: percentile(lens, 90),
        latestPublishedAt: latest,
        stalenessDays,
        flags,
      }
    })
}
