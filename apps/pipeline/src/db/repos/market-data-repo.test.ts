import { closeDb, getDb } from '@suanomics/db/client'
import { marketDataPoints } from '@suanomics/db/schema'
import { inArray } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { getLatestPoints, upsertMarketDataPoints } from './market-data-repo.js'

// test- prefix series 隔離測試資料、避免污染真實序列
const TEST_SERIES = ['test-cpi', 'test-10y', 'test-asof']

async function cleanup() {
  await getDb().delete(marketDataPoints).where(inArray(marketDataPoints.seriesId, TEST_SERIES))
}

beforeAll(cleanup)
beforeEach(cleanup)
afterAll(async () => {
  await cleanup()
  await closeDb()
})

describe('market-data-repo', () => {
  it('upserts points idempotently on (seriesId, date)', async () => {
    await upsertMarketDataPoints([{ seriesId: 'test-cpi', date: '2026-05-01', value: 3.3 }])
    await upsertMarketDataPoints([{ seriesId: 'test-cpi', date: '2026-05-01', value: 3.1 }])
    const pts = await getLatestPoints('test-cpi', 5)
    expect(pts).toHaveLength(1)
    expect(pts[0]?.value).toBeCloseTo(3.1)
  })

  it('returns latest-first limited points', async () => {
    await upsertMarketDataPoints([
      { seriesId: 'test-10y', date: '2026-06-10', value: 4.28 },
      { seriesId: 'test-10y', date: '2026-06-11', value: 4.32 },
    ])
    const pts = await getLatestPoints('test-10y', 2)
    expect(pts[0]).toEqual({ date: '2026-06-11', value: 4.32 })
    expect(pts[1]).toEqual({ date: '2026-06-10', value: 4.28 })
  })

  // ★ 補跑歷史報告時，快照不能拿到報告日之後的點。沒有這個上界的話 2026-09-02 的
  //   報告會寫「9/4 收盤的費半 11,735 點」——日期標得誠實，但那天還不存在
  //   （2026-09-05 本機補跑實際踩到）。同一條紀律官方公告的窗早就有了。
  it('asOf 鎖住上界：不回報告日之後的點', async () => {
    await upsertMarketDataPoints([
      { seriesId: 'test-asof', date: '2026-09-01', value: 1 },
      { seriesId: 'test-asof', date: '2026-09-02', value: 2 },
      { seriesId: 'test-asof', date: '2026-09-04', value: 3 },
    ])
    const bounded = await getLatestPoints('test-asof', 2, '2026-09-02')
    expect(bounded).toEqual([{ date: '2026-09-02', value: 2 }, { date: '2026-09-01', value: 1 }])
    // 邊界含當日
    expect((await getLatestPoints('test-asof', 1, '2026-09-04'))[0]).toEqual({ date: '2026-09-04', value: 3 })
    // ★ 負向對照：不帶 asOf 時無上界。它擋的是「**無條件**加上界」那種實作
    //   （例如永遠拿 today 當上界），不是「永遠回全部」——後者由上面第一條斷言擋。
    //   這條註解第一版寫反了，是驗收突變實測糾正的：把 where 換回無條件的
    //   `eq(seriesId)`（永遠回全部）時紅的是上面那條，這一條照樣綠。
    expect((await getLatestPoints('test-asof', 1))[0]).toEqual({ date: '2026-09-04', value: 3 })
    // 上界早於所有資料 → 空陣列，而不是回退成最新點
    expect(await getLatestPoints('test-asof', 2, '2026-08-31')).toEqual([])
  })

  it('dedupes duplicate (seriesId, date) within a single batch, last-wins', async () => {
    // 同批兩筆同 key：Postgres ON CONFLICT 無法二次影響同一 row、未 dedupe 會炸。
    const count = await upsertMarketDataPoints([
      { seriesId: 'test-cpi', date: '2026-05-01', value: 3.3 },
      { seriesId: 'test-cpi', date: '2026-05-01', value: 3.1 },
    ])
    expect(count).toBe(1)
    const pts = await getLatestPoints('test-cpi', 5)
    expect(pts).toHaveLength(1)
    expect(pts[0]?.value).toBeCloseTo(3.1)
  })

  it('returns count of actually inserted rows', async () => {
    const count = await upsertMarketDataPoints([
      { seriesId: 'test-10y', date: '2026-06-10', value: 4.28 },
      { seriesId: 'test-10y', date: '2026-06-11', value: 4.32 },
    ])
    expect(count).toBe(2)
  })

  it('returns 0 for an empty batch', async () => {
    const count = await upsertMarketDataPoints([])
    expect(count).toBe(0)
  })

  it('skips non-finite values', async () => {
    const count = await upsertMarketDataPoints([
      { seriesId: 'test-cpi', date: '2026-05-01', value: 3.3 },
      { seriesId: 'test-cpi', date: '2026-05-02', value: Number.NaN },
      { seriesId: 'test-cpi', date: '2026-05-03', value: Infinity },
    ])
    expect(count).toBe(1)
    const pts = await getLatestPoints('test-cpi', 5)
    expect(pts).toHaveLength(1)
    expect(pts[0]).toEqual({ date: '2026-05-01', value: 3.3 })
  })
})
