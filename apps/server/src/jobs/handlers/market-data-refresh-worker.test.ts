import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as marketDataRefresh from '../../market-data/refresh.js'
import { processMarketDataRefreshJob } from './market-data-refresh-worker.js'

vi.mock('../../market-data/refresh.js')

describe('processMarketDataRefreshJob', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('calls refreshMarketData and returns the refresh summary', async () => {
    vi.mocked(marketDataRefresh.refreshMarketData).mockResolvedValue({
      seriesProcessed: 15,
      pointsUpserted: 120,
      failures: [],
    })
    const updateProgress = vi.fn()
    const r = await processMarketDataRefreshJob({ updateProgress })
    expect(r.seriesProcessed).toBe(15)
    expect(r.pointsUpserted).toBe(120)
    expect(r.failures).toEqual([])
    expect(updateProgress).toHaveBeenCalledWith(100)
  })

  it('propagates refreshMarketData thrown errors so worker can mark failed', async () => {
    vi.mocked(marketDataRefresh.refreshMarketData).mockRejectedValue(new Error('db down'))
    await expect(processMarketDataRefreshJob({})).rejects.toThrow(/db down/)
  })
})
