import type { CalendarEvent } from '@suanomics/shared'
import type { AnnouncementMarket, MaterialAnnouncement } from './market-data/material-announcements.js'
import type { ListedCompany } from './market-data/twse-openapi.js'
import { readFileSync } from 'node:fs'
import { taipeiDateOf } from '@suanomics/shared'
import { insertMaterialAnnouncements, upsertEconCalendarEvents } from '../db/repos/ingest-repo.js'
import { upsertMarketDataPoints } from '../db/repos/market-data-repo.js'
import { NEWS_FETCH_USER_AGENT } from './external/scraper.js'
import { EconCalendarSchema } from './market-data/calendar.js'
import { FED_CALENDAR_URL, mergeCalendarEvents, parseFedCalendar } from './market-data/fed-calendar.js'
import { fetchSource } from './market-data/fetch-source.js'
import { companiesMentioned, filterAnnouncements, parseMaterialAnnouncements } from './market-data/material-announcements.js'
import { allCompaniesWithVolume, latestTradeDate, parseMarginTotals, parseMiIndex, parseQfiiCategory, topVolumeCompanies } from './market-data/twse-openapi.js'

const TWSE = 'https://openapi.twse.com.tw/v1'
const TPEX = 'https://www.tpex.org.tw/openapi/v1'
// TPEx 日收盤在 Actions 上要約 22 秒（ADR 0002）。
const STRUCTURED_TIMEOUT_MS = 60_000
const TOP_VOLUME_LIMIT = 50

async function fetchJson(url: string): Promise<unknown> {
  return fetchSource(url, {
    label: `structured: ${url}`,
    timeoutMs: STRUCTURED_TIMEOUT_MS,
    init: { headers: { 'user-agent': NEWS_FETCH_USER_AGENT } },
  })
}

async function fetchRows(url: string): Promise<unknown[]> {
  const body = await fetchJson(url)
  if (!Array.isArray(body))
    throw new TypeError(`structured: ${url} 回應不是陣列`)
  return body
}

export interface TwseRefreshResult {
  pointsUpserted: number
  companies: ListedCompany[]
  topVolume: ListedCompany[]
}

export async function refreshTwseOpenapi(): Promise<TwseRefreshResult> {
  const miIndex = await fetchRows(`${TWSE}/exchangeReport/MI_INDEX`)
  const date = latestTradeDate(miIndex)
  if (date === null)
    throw new Error('structured: MI_INDEX 沒有交易日')
  const [qfii, margin, twseDay, tpexDay] = [
    await fetchRows(`${TWSE}/fund/MI_QFIIS_cat`),
    await fetchRows(`${TWSE}/exchangeReport/MI_MARGN`),
    await fetchRows(`${TWSE}/exchangeReport/STOCK_DAY_ALL`),
    await fetchRows(`${TPEX}/tpex_mainboard_daily_close_quotes`),
  ]
  const pointsUpserted = await upsertMarketDataPoints([
    ...parseMiIndex(miIndex),
    ...parseQfiiCategory(qfii, date),
    ...parseMarginTotals(margin, date),
  ])
  return {
    pointsUpserted,
    companies: allCompaniesWithVolume(twseDay, tpexDay).map(({ code, name }) => ({ code, name })),
    topVolume: topVolumeCompanies(twseDay, tpexDay, TOP_VOLUME_LIMIT),
  }
}

const ANNOUNCEMENT_ENDPOINTS: readonly (readonly [AnnouncementMarket, string])[] = [
  ['twse', `${TWSE}/opendata/t187ap04_L`],
  ['tpex', `${TPEX}/mopsfin_t187ap04_O`],
]

export async function ingestMaterialAnnouncements(
  selectedTexts: readonly string[],
  companies: readonly ListedCompany[],
  topVolume: readonly ListedCompany[],
): Promise<{ fetched: number, kept: number, inserted: number }> {
  const all: MaterialAnnouncement[] = []
  for (const [market, url] of ANNOUNCEMENT_ENDPOINTS)
    all.push(...parseMaterialAnnouncements(await fetchRows(url), market))
  const codes = new Set([...companiesMentioned(selectedTexts, companies), ...topVolume.map(c => c.code)])
  const kept = filterAnnouncements(all, codes)
  return { fetched: all.length, kept: kept.length, inserted: await insertMaterialAnnouncements(kept) }
}

// CPI、非農與央行理監事會的官方來源（BLS、主計總處）擋程式存取，這些日期維持手動種子。
function loadManualCalendar(): CalendarEvent[] {
  const raw = readFileSync(new URL('../../data/econ-calendar.json', import.meta.url), 'utf-8')
  return EconCalendarSchema.parse(JSON.parse(raw)).events
}

export async function ingestEconCalendar(now: Date): Promise<{ manual: number, fed: number, upserted: number }> {
  const manual = loadManualCalendar()
  const fed = parseFedCalendar(await fetchJson(FED_CALENDAR_URL), taipeiDateOf(now))
  const manualSet = new Set(manual)
  const merged = mergeCalendarEvents(manual, fed)
  const upserted = await upsertEconCalendarEvents(merged.map(e => ({ ...e, source: manualSet.has(e) ? 'manual' : 'fed-json' })))
  return { manual: manual.length, fed: fed.length, upserted }
}
