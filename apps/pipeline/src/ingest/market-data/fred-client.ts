import type { RawPoint } from './transform.js'
import { fetchSource, SOURCE_TIMEOUT_MS } from './fetch-source.js'

// FRED 觀測值與其他來源共用同一 point 型別、避免同構宣告漂移。
export type FredPoint = RawPoint

const FRED_BASE = 'https://api.stlouisfed.org/fred/series/observations'

export interface FetchFredParams { fredId: string, apiKey: string, limit: number, timeoutMs?: number }

export async function fetchFredObservations(p: FetchFredParams): Promise<RawPoint[]> {
  const url = `${FRED_BASE}?series_id=${encodeURIComponent(p.fredId)}&api_key=${encodeURIComponent(p.apiKey)}&file_type=json&sort_order=desc&limit=${p.limit}`
  const body = await fetchSource<{ observations?: { date: string, value: string }[] }>(url, {
    label: `fred-client: ${p.fredId}`,
    timeoutMs: p.timeoutMs ?? SOURCE_TIMEOUT_MS,
  })
  // `.` 是 FRED 表示「該期無觀測值」的佔位，不是 0。
  return (body.observations ?? [])
    .filter(o => o.value !== '.')
    .map(o => ({ date: o.date, value: Number(o.value) }))
    .filter(o => Number.isFinite(o.value))
    .sort((a, b) => a.date.localeCompare(b.date))
}
