import type { RunNewsRefreshResult } from './news/refresh.js'
import process from 'node:process'
import { isTwseTradingDay, taipeiDateOf } from '@suanomics/shared'
import { CostGateError } from '../agents/cost-gate.js'
import { getRelevanceCandidates } from '../db/repos/news-repo.js'
import { refreshMarketData } from './market-data/refresh.js'
import { runNewsRefresh } from './news/refresh.js'
import { DEFAULT_SELECTION_TOTAL, parseCategoryFloors, selectWithCategoryFloors } from './news/selection.js'
import { ingestEconCalendar, ingestMaterialAnnouncements, refreshTwseOpenapi } from './structured.js'

const CANDIDATE_WINDOW_DAYS = 2

export type IngestResult
  = | { status: 'skipped', date: string }
    | { status: 'done', date: string, news: RunNewsRefreshResult, selected: number, failures: string[] }

export async function runIngest(options: { now?: Date, force?: boolean } = {}): Promise<IngestResult> {
  const now = options.now ?? new Date()
  const date = taipeiDateOf(now)
  if (!options.force && !isTwseTradingDay(date))
    return { status: 'skipped', date }

  const failures: string[] = []
  // 一個來源掛掉不該讓其餘資料也沒進庫；花費閘例外才要整批停。
  const attempt = async <T>(step: string, run: () => Promise<T>): Promise<T | null> => {
    try {
      return await run()
    }
    catch (err) {
      if (err instanceof CostGateError)
        throw err
      failures.push(step)
      console.error(`[ingest] ${step} failed:`, err)
      return null
    }
  }

  const news = await runNewsRefresh()
  const twse = await attempt('twse-openapi', refreshTwseOpenapi)
  const market = await attempt('market-data', () => refreshMarketData({ fredApiKey: process.env.FRED_API_KEY ?? '' }))
  if (market)
    console.warn(`[ingest] market-data ${market.pointsUpserted} points, failed series: ${market.failures.join(', ') || 'none'}`)

  const candidates = await getRelevanceCandidates(date, CANDIDATE_WINDOW_DAYS)
  const selected = selectWithCategoryFloors(candidates, {
    total: DEFAULT_SELECTION_TOTAL,
    floors: parseCategoryFloors(process.env.NEWS_CATEGORY_FLOORS),
  })
  if (twse) {
    const texts = selected.map(c => `${c.title}\n${c.contentText ?? ''}`)
    const announcements = await attempt('material-announcements', () => ingestMaterialAnnouncements(texts, twse.companies, twse.topVolume))
    if (announcements)
      console.warn(`[ingest] material announcements fetched=${announcements.fetched} kept=${announcements.kept} inserted=${announcements.inserted}`)
  }
  const calendar = await attempt('econ-calendar', () => ingestEconCalendar(now))
  if (calendar)
    console.warn(`[ingest] econ calendar manual=${calendar.manual} fed=${calendar.fed} upserted=${calendar.upserted}`)

  return { status: 'done', date, news, selected: selected.length, failures }
}
