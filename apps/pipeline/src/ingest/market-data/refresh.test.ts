import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { refreshMarketData } from './refresh.js'

// 實測教訓：加新 source 卻沒補既有測試的 fetcher mock，deps 會 fall-through 到真實
// fetcher、對外網發請求變 flaky。這道守衛讓「漏補 mock」當場炸掉，而不是靜默打外網。
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => {
    throw new Error('refresh.test 不得對外網發請求：某個 source 的 fetcher mock 漏補了')
  }))
})
afterEach(() => vi.unstubAllGlobals())

describe('refreshMarketData', () => {
  it('continues other series when one source fails, reports failures', async () => {
    const deps = {
      fredApiKey: 'k',
      fetchFred: vi.fn(async ({ fredId }: { fredId: string }) => {
        if (fredId === 'DGS10')
          throw new Error('boom')
        return [{ date: '2026-06-11', value: 1 }]
      }),
      fetchTwseSeries: vi.fn(async () => [{ date: '2026-06-11', value: 23150 }]),
      fetchTaifexSeries: vi.fn(async () => []),
      fetchNasdaqSeries: vi.fn(async () => []),
      upsert: vi.fn(async (pts: unknown[]) => pts.length),
      getLatest: vi.fn(async () => [{ date: '2026-06-11', value: 1 }]),
    }
    const r = await refreshMarketData(deps)
    expect(r.failures).toContain('us-10y-yield')
    expect(r.seriesProcessed).toBeGreaterThan(0)
    // 失敗的 fred 序列不擋其他：twse 仍被呼叫
    expect(deps.fetchTwseSeries).toHaveBeenCalled()
  })

  it('skips FRED series entirely without api key', async () => {
    const fetchFred = vi.fn()
    const r = await refreshMarketData({
      fredApiKey: '',
      fetchFred,
      fetchTwseSeries: vi.fn(async () => []),
      fetchTaifexSeries: vi.fn(async () => []),
      fetchNasdaqSeries: vi.fn(async () => []),
      upsert: vi.fn(async () => 0),
      getLatest: vi.fn(async () => []),
    })
    expect(fetchFred).not.toHaveBeenCalled()
    expect(r.failures).toEqual(expect.arrayContaining(['us-cpi-yoy']))
  })

  it('computes derived spread from landed leg values via getLatest', async () => {
    const upsert = vi.fn(async (pts: unknown[]) => pts.length)
    // 兩腿在 DB 落地值（同日）：10y=4.32、2y=3.90 → spread 0.42
    const getLatest = vi.fn(async (seriesId: string) => {
      if (seriesId === 'us-10y-yield')
        return [{ date: '2026-06-11', value: 4.32 }]
      if (seriesId === 'us-2y-yield')
        return [{ date: '2026-06-11', value: 3.90 }]
      return []
    })
    await refreshMarketData({
      fredApiKey: 'k',
      fetchFred: vi.fn(async () => [{ date: '2026-06-11', value: 1 }]),
      fetchTwseSeries: vi.fn(async () => []),
      fetchTaifexSeries: vi.fn(async () => []),
      fetchNasdaqSeries: vi.fn(async () => []),
      upsert,
      getLatest,
    })
    const spreadCall = upsert.mock.calls.find(call =>
      Array.isArray(call[0])
      && (call[0] as { seriesId?: string }[])[0]?.seriesId === 'us-yield-spread-10y2y')
    expect(spreadCall).toBeDefined()
    expect(spreadCall?.[0]).toEqual([
      { seriesId: 'us-yield-spread-10y2y', date: '2026-06-11', value: expect.closeTo(0.42, 5) },
    ])
  })

  it('fetches taifex source and isolates its failures', async () => {
    const fetchTaifexSeries = vi.fn(async () => {
      throw new Error('taifex boom')
    })
    const r = await refreshMarketData({
      fredApiKey: 'k',
      fetchFred: vi.fn(async () => [{ date: '2026-07-07', value: 1 }]),
      fetchTwseSeries: vi.fn(async () => [{ date: '2026-07-07', value: 23150 }]),
      fetchTaifexSeries,
      fetchNasdaqSeries: vi.fn(async () => []),
      upsert: vi.fn(async (pts: unknown[]) => pts.length),
      getLatest: vi.fn(async () => [{ date: '2026-07-07', value: 1 }]),
    })
    expect(fetchTaifexSeries).toHaveBeenCalled()
    expect(r.failures).toContain('foreign-taifex-net')
    // taifex 失敗不擋其他：fred/twse 仍 upsert
    expect(r.pointsUpserted).toBeGreaterThan(0)
  })

  it('upserts fetched taifex points for foreign-taifex-net', async () => {
    const upsert = vi.fn(async (pts: unknown[]) => pts.length)
    const fetchTaifexSeries = vi.fn(async () => [{ date: '2026-07-07', value: -80042 }])
    await refreshMarketData({
      fredApiKey: 'k',
      fetchFred: vi.fn(async () => [{ date: '2026-07-07', value: 1 }]),
      fetchTwseSeries: vi.fn(async () => [{ date: '2026-07-07', value: 23150 }]),
      fetchTaifexSeries,
      fetchNasdaqSeries: vi.fn(async () => []),
      upsert,
      getLatest: vi.fn(async () => []),
    })
    const taifexCall = upsert.mock.calls.find(call =>
      Array.isArray(call[0])
      && (call[0] as { seriesId?: string }[]).some(p => p.seriesId === 'foreign-taifex-net'))
    expect(taifexCall).toBeDefined()
    expect(taifexCall?.[0]).toEqual([
      { seriesId: 'foreign-taifex-net', date: '2026-07-07', value: -80042 },
    ])
  })

  it('upserts fetched nasdaq points for us-sox and isolates its failures', async () => {
    const upsert = vi.fn(async (pts: unknown[]) => pts.length)
    // 兩條 nasdaq 序列共用同一個 fetcher：SOX 成功、COMP 失敗，驗互不牽連。
    const fetchNasdaqSeries = vi.fn(async (spec: { sourceCode: string }) => {
      if (spec.sourceCode === 'COMP')
        throw new Error('nasdaq boom')
      return [{ date: '2026-07-30', value: 11302.99 }]
    })
    const r = await refreshMarketData({
      fredApiKey: 'k',
      fetchFred: vi.fn(async () => [{ date: '2026-07-30', value: 1 }]),
      fetchTwseSeries: vi.fn(async () => [{ date: '2026-07-30', value: 23150 }]),
      fetchTaifexSeries: vi.fn(async () => []),
      fetchNasdaqSeries,
      upsert,
      getLatest: vi.fn(async () => []),
    })
    expect(fetchNasdaqSeries).toHaveBeenCalled()
    expect(r.failures).toContain('us-nasdaq-comp')
    expect(r.failures).not.toContain('us-sox')
    const soxCall = upsert.mock.calls.find(call =>
      Array.isArray(call[0])
      && (call[0] as { seriesId?: string }[]).some(p => p.seriesId === 'us-sox'))
    expect(soxCall?.[0]).toEqual([
      { seriesId: 'us-sox', date: '2026-07-30', value: 11302.99 },
    ])
  })
})
