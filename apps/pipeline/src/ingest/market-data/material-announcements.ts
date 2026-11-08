import type { ListedCompany } from './twse-openapi.js'
import { parseRocDate } from './twse-client.js'

export type AnnouncementMarket = 'twse' | 'tpex'

export interface MaterialAnnouncement {
  market: AnnouncementMarket
  companyCode: string
  companyName: string
  announcedAt: Date
  title: string
  body: string
  clause: string
}

// TWSE 的「主旨」欄名實際帶尾端空白，TPEx 沒有，所以欄名一律先 trim 再查。
function normalizeRow(row: unknown): Record<string, string> {
  return Object.fromEntries(
    Object.entries(row as Record<string, unknown>)
      .filter(([, value]) => typeof value === 'string')
      .map(([key, value]) => [key.trim(), (value as string).trim()]),
  )
}

// 發言時間是沒補零的 hhmmss（70003 = 07:00:03、3123 = 00:31:23），時區是台北。
function toAnnouncedAt(rocDate: string, time: string): Date {
  const padded = time.padStart(6, '0')
  return new Date(`${parseRocDate(rocDate)}T${padded.slice(0, 2)}:${padded.slice(2, 4)}:${padded.slice(4, 6)}+08:00`)
}

export function parseMaterialAnnouncements(rows: readonly unknown[], market: AnnouncementMarket): MaterialAnnouncement[] {
  return rows.flatMap((raw) => {
    const row = normalizeRow(raw)
    const companyCode = row['公司代號'] ?? row.SecuritiesCompanyCode ?? ''
    const title = (row['主旨'] ?? '').replace(/\s*\n\s*/g, '')
    const rocDate = row['發言日期'] ?? ''
    if (companyCode === '' || title === '' || rocDate === '')
      return []
    return [{
      market,
      companyCode,
      companyName: row['公司名稱'] ?? row.CompanyName ?? '',
      announcedAt: toAnnouncedAt(rocDate, row['發言時間'] ?? '0'),
      title,
      body: row['說明'] ?? '',
      clause: row['符合條款'] ?? '',
    }]
  })
}

export function filterAnnouncements(
  announcements: readonly MaterialAnnouncement[],
  companyCodes: ReadonlySet<string>,
): MaterialAnnouncement[] {
  return announcements.filter(a => companyCodes.has(a.companyCode))
}

export function companiesMentioned(texts: readonly string[], companies: readonly ListedCompany[]): Set<string> {
  const corpus = texts.join('\n')
  return new Set(companies.filter(c => corpus.includes(c.name) || corpus.includes(c.code)).map(c => c.code))
}
