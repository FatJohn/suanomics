import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAnalyzeJob } from './useAnalyzeJob'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

const sampleBrief = {
  headline: 'h',
  summary: 's',
  relatedNews: [],
  affectedIndustries: [],
  relatedETFs: [],
  reasoningChain: ['r1', 'r2'],
  citations: [{ url: 'https://x/1', title: 't', quote: 'q' }],
  disclaimer: '本分析僅供參考、非投資建議、實際投資請諮詢專業人士',
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

async function flush() {
  // 讓 microtasks 跑完（React-like async settle）
  for (let i = 0; i < 5; i++)
    await Promise.resolve()
}

describe('useAnalyzeJob', () => {
  it('happy path: submit → poll active → poll completed → fetchResult', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 202, json: async () => ({ auditId: 'a-1', status: 'queued' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ status: 'active', progress: 25, stage: 'routing', routingMode: null, resultRef: null }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ status: 'completed', progress: 100, stage: null, routingMode: 'full-pipeline', resultRef: 'analyses/42' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => sampleBrief })

    const job = useAnalyzeJob()
    const p = job.start({ title: 'T', content: 'C' })
    await flush()
    // POST 完、進 polling
    await flush()
    // 1st poll (advance 2000ms)
    await vi.advanceTimersByTimeAsync(2000)
    await flush()
    expect(job.percent.value).toBe(25)
    expect(job.stage.value).toBe('routing')
    // 2nd poll → completed → fetchResult
    await vi.advanceTimersByTimeAsync(2000)
    await flush()
    await p
    expect(job.status.value).toBe('completed')
    expect(job.result.value).toEqual(sampleBrief)
    expect(job.routingMode.value).toBe('full-pipeline')
  })

  it('already-completed shortcut (no polling)', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 202, json: async () => ({ auditId: 'a-2', status: 'already-completed', resultRef: 'analyses/7' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => sampleBrief })

    const job = useAnalyzeJob()
    const p = job.start({ title: 'T', content: 'C' })
    await flush()
    // 0.5s flash for cache-hit
    await vi.advanceTimersByTimeAsync(500)
    await flush()
    await p
    expect(job.status.value).toBe('completed')
    expect(job.result.value).toEqual(sampleBrief)
    // 只打 2 次 (POST + analyses/:id)、沒進 poll loop
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('cancel mid-poll: status=cancelled', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 202, json: async () => ({ auditId: 'a-3', status: 'queued' }) })
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ status: 'active', progress: 25, stage: 'routing', routingMode: null }) })

    const job = useAnalyzeJob()
    const p = job.start({ title: 'T', content: 'C' })
    await flush()
    await vi.advanceTimersByTimeAsync(2000)
    await flush()
    job.cancel()
    // 讓 poll loop 內的下一個 setTimeout(POLL_INTERVAL_MS) drain、loop 才能 check
    // status !== 'polling' 並 return
    await vi.advanceTimersByTimeAsync(2000)
    await flush()
    await p.catch(() => undefined)
    expect(job.status.value).toBe('cancelled')
    expect(job.error.value?.kind).toBe('cancelled')
  })

  it('timeout: 120s without completion', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 202, json: async () => ({ auditId: 'a-4', status: 'queued' }) })
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ status: 'active', progress: 50, stage: 'analyzing', routingMode: null }) })

    const job = useAnalyzeJob()
    const p = job.start({ title: 'T', content: 'C' })
    await flush()
    await vi.advanceTimersByTimeAsync(120_000)
    await flush()
    await p.catch(() => undefined)
    expect(job.status.value).toBe('timeout')
    expect(job.error.value?.kind).toBe('timeout')
  })

  it('400 input error reports as input kind', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: 'invalid_input', detail: 'title too short' }),
    })
    const job = useAnalyzeJob()
    await job.start({ title: 'T', content: 'C' })
    expect(job.status.value).toBe('failed')
    expect(job.error.value?.kind).toBe('input')
    expect(job.error.value?.message).toContain('title too short')
  })

  it('5xx initial error reports as server kind', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({ error: 'enqueue_failed', detail: 'db down' }),
    })
    const job = useAnalyzeJob()
    await job.start({ title: 'T', content: 'C' })
    expect(job.status.value).toBe('failed')
    expect(job.error.value?.kind).toBe('server')
  })
})
