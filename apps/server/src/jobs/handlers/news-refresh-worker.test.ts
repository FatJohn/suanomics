import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as newsRefresh from '../../news/refresh.js'
import { processNewsRefreshJob } from './news-refresh-worker.js'

vi.mock('../../news/refresh.js')

describe('processNewsRefreshJob', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('calls runNewsRefresh and returns the result ref + summary', async () => {
    vi.mocked(newsRefresh.runNewsRefresh).mockResolvedValue({
      sourcesProcessed: 5,
      sourcesFailed: 0,
      totalInserted: 12,
      perSource: [],
    })
    const updateProgress = vi.fn()
    const r = await processNewsRefreshJob({ updateProgress })
    expect(r.totalInserted).toBe(12)
    expect(r.sourcesProcessed).toBe(5)
    expect(updateProgress).toHaveBeenCalledWith(100)
  })

  it('propagates runNewsRefresh thrown errors so worker can mark failed', async () => {
    vi.mocked(newsRefresh.runNewsRefresh).mockRejectedValue(new Error('db blip'))
    await expect(processNewsRefreshJob({})).rejects.toThrow(/db blip/)
  })
})
