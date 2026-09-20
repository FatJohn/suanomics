import { describe, expect, it, vi } from 'vitest'

const getLatestPoints = vi.fn(async (seriesId: string) => {
  const fixtures: Record<string, { date: string, value: number }[]> = {
    'taiex-close': [{ date: '2026-06-13', value: 23150 }, { date: '2026-06-12', value: 23000 }],
    'us-10y-yield': [{ date: '2026-06-13', value: 4.32 }, { date: '2026-06-12', value: 4.30 }],
  }
  return fixtures[seriesId] ?? []
})

vi.mock('@suanomics/db/repos/market-data-repo', () => ({
  getLatestPoints: (...args: unknown[]) => getLatestPoints(...args as [string]),
}))

// eslint-disable-next-line import/first
import { isValidDateParam, marketRoute } from './market.js'

describe('marketRoute GET /market/snapshot', () => {
  it('shouldReturnKeyNumbersWithValuesAndDirectionFromRepo', async () => {
    const res = await marketRoute.request('/market/snapshot')
    expect(res.status).toBe(200)
    const json = await res.json() as { series: { seriesId: string, latest: { value: number }, direction: string }[] }
    const t = json.series.find(s => s.seriesId === 'taiex-close')
    expect(t?.latest.value).toBe(23150)
    expect(t?.direction).toBe('up')
  })

  it('shouldSkipSeriesWithNoDataFromRepo', async () => {
    const res = await marketRoute.request('/market/snapshot')
    const json = await res.json() as { series: { seriesId: string }[] }
    expect(json.series.map(s => s.seriesId).sort()).toEqual(['taiex-close', 'us-10y-yield'])
  })

  // 無 date query 必須是現行行為（asOf undefined、當下最新值）——否則歷史頁修好了、
  // 首頁的即時卡片被暗中改成 asOf 查詢。
  it('shouldPassUndefinedAsOfWhenNoDateQuery', async () => {
    getLatestPoints.mockClear()
    await marketRoute.request('/market/snapshot')
    for (const call of getLatestPoints.mock.calls)
      expect(call[2]).toBeUndefined()
  })

  // 主線：帶合法 date 要把它當 asOf 傳給 repo、且 reportDate（freshness 期望值的基準）
  // 也要用它，不能仍用「今天」——否則歷史頁的每個序列都會被標成落後好幾個月。
  it('shouldPassDateAsAsOfAndUseItAsReportDateWhenDateQueryGiven', async () => {
    getLatestPoints.mockClear()
    const res = await marketRoute.request('/market/snapshot?date=2026-06-13')
    expect(res.status).toBe(200)
    for (const call of getLatestPoints.mock.calls)
      expect(call[2]).toBe('2026-06-13')
    const json = await res.json() as { series: { seriesId: string, freshness: { state: string } }[] }
    // taiex-close 的 latest.date 恰好等於 dateParam 當天，若 reportDate 正確跟著 date 走，
    // lagCycles=0 應為 'fresh'。若 reportDate 錯用「今天」（跟 fixture 差近 3 個月），
    // 會被判成遠遠落後而變 'stale'——用這個差異固定住 reportDate 有沒有跟著走，不依賴
    // 執行當下的真實日期。
    const t = json.series.find(s => s.seriesId === 'taiex-close')
    expect(t?.freshness.state).toBe('fresh')
  })

  // 格式不合法要明確 400，不能靜靜當成沒帶（會讓前端傳錯參數時看起來一切正常）。
  it('shouldReturn400WhenDateQueryIsMalformed', async () => {
    const res = await marketRoute.request('/market/snapshot?date=2026/06/13')
    expect(res.status).toBe(400)
    const json = await res.json() as { error: string }
    expect(json.error).toBe('invalid_date')
  })
})

describe('isValidDateParam', () => {
  it('shouldAcceptWellFormedIsoDate', () => {
    expect(isValidDateParam('2026-06-13')).toBe(true)
  })

  it('shouldRejectMalformedDate', () => {
    expect(isValidDateParam('2026/06/13')).toBe(false)
    expect(isValidDateParam('not-a-date')).toBe(false)
    expect(isValidDateParam('')).toBe(false)
  })

  // ★ 驗收 finding：只驗形狀的話這幾個都會過關，被當成 asOf 送進 Postgres → query 丟錯
  //   → 500，而錯誤訊息開頭正是完整 SQL。形狀對不等於是一個日子。
  it('shouldRejectShapeValidButNonExistentDates', () => {
    expect(isValidDateParam('2026-13-45')).toBe(false)
    expect(isValidDateParam('2026-02-30')).toBe(false)
    expect(isValidDateParam('0000-00-00')).toBe(false)
    expect(isValidDateParam('2026-00-10')).toBe(false)
    // 真的存在的閏日仍要收
    expect(isValidDateParam('2024-02-29')).toBe(true)
  })
})

describe('/market/snapshot 的錯誤回應不外露內部細節', () => {
  // ★ 驗收 finding：原本 500 會回一段截到 200 字的錯誤訊息，而截斷限的是長度、不是
  //   敏感度——drizzle 的訊息開頭就是完整 SQL，前 200 字剛好把資料表與欄位名交出去。
  //   開了 `?date=` 之後，觸發路徑從「只有基礎設施故障」變成使用者可控。
  it('shouldNotLeakQueryDetailsOnFailure', async () => {
    getLatestPoints.mockRejectedValueOnce(new Error('Failed query: select "date", "value" from "market_data_points" where ...'))
    const res = await marketRoute.request('/market/snapshot')
    expect(res.status).toBe(500)
    const json = await res.json() as Record<string, unknown>
    expect(json.error).toBe('market_snapshot_failed')
    expect(json).not.toHaveProperty('detail')
    expect(JSON.stringify(json)).not.toContain('market_data_points')
  })
})
