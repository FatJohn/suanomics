import { getLatestPoints } from '@suanomics/db/repos/market-data-repo'
import { buildKeyNumbers, KEY_NUMBER_SERIES, taipeiDateOf } from '@suanomics/shared'
import { Hono } from 'hono'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * `?date=` 讓 `/d/:date` 歷史頁能要那一天的收盤（而非永遠當下最新值）。
 *
 * ★ **形狀對不等於是一個日子**。只用 `DATE_RE` 的話 `2026-13-45` 會過關，被當成 `asOf`
 * 送進 Postgres、query 丟錯、落到下面的 catch 回 500——而在加上 `date` 查詢之前這個端點**不吃任何
 * 使用者輸入**，那個 catch 只有基礎設施故障才踩得到。開了 query 之後它變成任何人都能
 * 穩定觸發的路徑（2026-09-09 驗收實跑：`2026-13-45`、`2026-02-30`、`0000-00-00` 都是
 * 500，而 body 的 detail 前 200 字正是資料表與欄位名）。所以這裡 round-trip 比對：
 * parse 回來再格式化，對不上就不是真的日子。
 */
export function isValidDateParam(date: string): boolean {
  if (!DATE_RE.test(date))
    return false
  const parsed = new Date(`${date}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date
}

export const marketRoute = new Hono()

// 本日關鍵數字：直讀 market_data_points、零 LLM。每序列取最新 2 筆（算方向）。
// 無 `date` query＝現行行為（當下最新值、報告日＝台北當日）；帶 `date`＝那一天的收盤，
// 給 `/d/:date` 歷史頁用。reportDate 必須跟著 date 走，否則歷史頁的每個序列都會
// 被 freshness 誤判成落後好幾個月（期望值仍以「今天」為基準）。
marketRoute.get('/market/snapshot', async (c) => {
  const dateParam = c.req.query('date')
  if (dateParam !== undefined && !isValidDateParam(dateParam))
    return c.json({ error: 'invalid_date' }, 400)

  try {
    const entries = await Promise.all(
      KEY_NUMBER_SERIES.map(async spec => [spec.seriesId, await getLatestPoints(spec.seriesId, 2, dateParam)] as const),
    )
    const pointsBySeriesId = Object.fromEntries(entries)
    // en-CA locale 的日期格式即 YYYY-MM-DD、且自帶零填補。
    const reportDate = dateParam ?? taipeiDateOf(new Date())
    return c.json(buildKeyNumbers(pointsBySeriesId, reportDate), 200)
  }
  catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // ★ 錯誤細節只留在伺服器端 log，**不回給呼叫端**。原本回一段截到 200 字的 message，
    // 而截斷限的是長度、不是敏感度——drizzle 的錯誤訊息開頭正是完整 SQL，所以前 200 字
    // 剛好把資料表與欄位名交出去。這個端點現在吃使用者輸入（`?date=`），洩漏路徑因此
    // 從「只有基礎設施故障」變成「任何人都能穩定觸發」（2026-09-09 驗收實跑）。
    console.error('[market/snapshot] failed:', message)
    return c.json({ error: 'market_snapshot_failed' }, 500)
  }
})
