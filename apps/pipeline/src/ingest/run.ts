import type { RelevanceCandidate } from '../db/repos/news-repo.js'
import type { RunNewsRefreshResult } from './news/refresh.js'
import process from 'node:process'
import { isTwseTradingDay, taipeiDateOf } from '@suanomics/shared'
import { CostGateError } from '../agents/cost-gate.js'
import { getRelevanceCandidates } from '../db/repos/news-repo.js'
import { getSourceFetchHistory, recordSourceFetchResults } from '../db/repos/source-fetch-repo.js'
import { refreshMarketData } from './market-data/refresh.js'
import { candidateWindowDays, selectAcrossClosure } from './news/candidate-window.js'
import { runNewsRefresh } from './news/refresh.js'
import { DEFAULT_SELECTION_TOTAL, parseCategoryFloors } from './news/selection.js'
import { CONSECUTIVE_FAILURE_THRESHOLD, findConsecutiveFailures, formatSourceAlert } from './news/source-failure-alert.js'
import { ingestEconCalendar, ingestMaterialAnnouncements, refreshTwseOpenapi } from './structured.js'

export type IngestResult
  = | { status: 'skipped', date: string }
    | { status: 'done', date: string, news: RunNewsRefreshResult, selected: RelevanceCandidate[], failures: string[] }

// 歷史窗只要涵蓋門檻天數；來源可能中間幾天沒跑（週末），多抓一週。
const ALERT_HISTORY_DAYS = CONSECUTIVE_FAILURE_THRESHOLD + 7

async function reportSourceFailures(date: string, news: RunNewsRefreshResult): Promise<void> {
  await recordSourceFetchResults(date, news.perSource.map(s => ({ slug: s.slug, failed: s.failed, httpStatus: s.httpStatus })))
  const since = new Date(Date.parse(`${date}T00:00:00Z`) - ALERT_HISTORY_DAYS * 864e5).toISOString().slice(0, 10)
  for (const alert of findConsecutiveFailures(await getSourceFetchHistory(since), CONSECUTIVE_FAILURE_THRESHOLD))
    console.warn(formatSourceAlert(alert))
}

export async function runIngest(options: { now?: Date, date?: string, force?: boolean } = {}): Promise<IngestResult> {
  const now = options.now ?? new Date()
  const date = options.date ?? taipeiDateOf(now)
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
  // 補跑舊日期時，當下的 feed 狀態不代表該報告日。
  if (date === taipeiDateOf(now))
    await attempt('source-failure-alert', () => reportSourceFailures(date, news))
  const twse = await attempt('twse-openapi', refreshTwseOpenapi)
  const market = await attempt('market-data', () => refreshMarketData({ fredApiKey: process.env.FRED_API_KEY ?? '' }))
  if (market)
    console.warn(`[ingest] market-data ${market.pointsUpserted} points, failed series: ${market.failures.join(', ') || 'none'}`)

  // 休市後第一個交易日的窗往回涵蓋整段休市期間，選稿逐日分散，見 candidate-window.ts。
  const candidates = await getRelevanceCandidates(date, candidateWindowDays(date))
  const selected = selectAcrossClosure(candidates, date, {
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

  return { status: 'done', date, news, selected, failures }
}
