import { parseRocDate } from './twse-client.js'

export interface SeriesPoint {
  seriesId: string
  date: string
  value: number
}

export interface ListedCompany {
  code: string
  name: string
}

type Row = Record<string, unknown>

// MI_INDEX 一次回兩百多個指數；只留選股判斷用得到的大盤與主要類股。
const MI_INDEX_SERIES: Readonly<Record<string, string>> = {
  發行量加權股價指數: 'twse-index-taiex',
  電子工業類指數: 'twse-index-electronics',
  半導體類指數: 'twse-index-semiconductor',
  金融保險類指數: 'twse-index-financial',
  航運類指數: 'twse-index-shipping',
}

function text(row: Row, key: string): string {
  const value = row[key]
  return typeof value === 'string' ? value.trim() : ''
}

function toNumber(raw: string): number {
  return raw === '' ? Number.NaN : Number(raw.replace(/,/g, ''))
}

export function parseMiIndex(rows: readonly unknown[]): SeriesPoint[] {
  return (rows as Row[]).flatMap((row) => {
    const seriesId = MI_INDEX_SERIES[text(row, '指數')]
    const value = toNumber(text(row, '收盤指數'))
    const rawDate = text(row, '日期')
    return seriesId !== undefined && rawDate !== '' && Number.isFinite(value)
      ? [{ seriesId, date: parseRocDate(rawDate), value }]
      : []
  })
}

/** 取 MI_INDEX 回應的交易日；外資持股與融資融券的回應本身沒有日期，靠這個對齊。 */
export function latestTradeDate(miIndexRows: readonly unknown[]): string | null {
  const raw = text((miIndexRows[0] ?? {}) as Row, '日期')
  return raw === '' ? null : parseRocDate(raw)
}

export function parseQfiiCategory(rows: readonly unknown[], date: string): SeriesPoint[] {
  return (rows as Row[]).flatMap((row) => {
    const category = text(row, 'IndustryCat')
    const value = toNumber(text(row, 'Percentage'))
    return category !== '' && Number.isFinite(value)
      ? [{ seriesId: `twse-qfii-pct:${category}`, date, value }]
      : []
  })
}

export function parseMarginTotals(rows: readonly unknown[], date: string): SeriesPoint[] {
  const sum = (key: string): number => (rows as Row[]).reduce((total, row) => {
    const value = toNumber(text(row, key))
    return Number.isFinite(value) ? total + value : total
  }, 0)
  return [
    { seriesId: 'twse-margin-lots-total', date, value: sum('融資今日餘額') },
    { seriesId: 'twse-short-lots-total', date, value: sum('融券今日餘額') },
  ]
}

// 四碼且非 00 開頭才是公司股票；ETF（00 開頭）與權證（六碼）沒有重大訊息要追。
function isCompanyCode(code: string): boolean {
  return /^[1-9]\d{3}$/.test(code)
}

export function topVolumeCompanies(
  twseRows: readonly unknown[],
  tpexRows: readonly unknown[],
  limit: number,
): ListedCompany[] {
  return allCompaniesWithVolume(twseRows, tpexRows)
    .sort((a, b) => b.volume - a.volume)
    .slice(0, limit)
    .map(({ code, name }) => ({ code, name }))
}

export function allCompaniesWithVolume(
  twseRows: readonly unknown[],
  tpexRows: readonly unknown[],
): (ListedCompany & { volume: number })[] {
  const twse = (twseRows as Row[]).map(r => ({ code: text(r, 'Code'), name: text(r, 'Name'), volume: toNumber(text(r, 'TradeVolume')) }))
  const tpex = (tpexRows as Row[]).map(r => ({ code: text(r, 'SecuritiesCompanyCode'), name: text(r, 'CompanyName'), volume: toNumber(text(r, 'TradingShares')) }))
  return [...twse, ...tpex].filter(c => isCompanyCode(c.code) && Number.isFinite(c.volume))
}
