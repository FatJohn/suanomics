import type { SeriesSpec } from './series-config.js'
import type { RawPoint } from './transform.js'
import { fetchSource, SOURCE_TIMEOUT_MS } from './fetch-source.js'

const TPEX_OPENAPI_BASE = 'https://www.tpex.org.tw/openapi/v1'

/**
 * tpex_index（櫃買指數歷史資料、TPEx OpenAPI）→ 櫃買指數收盤點數。
 * 回物件陣列、當月逐日一列；`Date` 是西元 yyyymmdd（不是 TWSE OpenAPI 的民國 7 碼）、`Close` 無千分位。
 */
export function parseTpexIndex(body: unknown): RawPoint[] {
  if (!Array.isArray(body)) {
    console.warn(`tpex-client: tpex_index expected array body, got ${typeof body} — skip`)
    return []
  }
  return body.flatMap((r: { Date?: unknown, Close?: unknown }) => {
    const date = typeof r.Date === 'string' && /^\d{8}$/.test(r.Date) ? r.Date : ''
    const value = typeof r.Close === 'string' ? Number(r.Close) : Number.NaN
    return date && Number.isFinite(value)
      ? [{ date: `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`, value }]
      : []
  })
}

/** 依 SeriesSpec 拉單一 TPEx OpenAPI 序列；`sourceCode` 是 OpenAPI base 之後的路徑。 */
export async function fetchTpexSeries(spec: SeriesSpec): Promise<RawPoint[]> {
  const body = await fetchSource(`${TPEX_OPENAPI_BASE}${spec.sourceCode}`, {
    label: `tpex-client: ${spec.sourceCode}`,
    timeoutMs: SOURCE_TIMEOUT_MS,
  })
  return parseTpexIndex(body)
}
