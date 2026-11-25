import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import worker from './index.js'

const env = { GITHUB_DISPATCH_TOKEN: 'test-token' }
const DISPATCH_URL = 'https://api.github.com/repos/FatJohn/suanomics/actions/workflows/daily.yml/dispatches'
const RUNS_URL = 'https://api.github.com/repos/FatJohn/suanomics/actions/workflows/daily.yml/runs'
const headers = {
  'Accept': 'application/vnd.github+json',
  'Authorization': 'Bearer test-token',
  'User-Agent': 'suanomics-trigger',
  'X-GitHub-Api-Version': '2022-11-28',
}

// 2026-11-25 21:00Z 與 21:40Z，即台北 11/26 05:00 與 05:40。
const primary = { cron: '0 21 * * *', scheduledTime: Date.UTC(2026, 10, 25, 21, 0) }
const backup = { cron: '40 21 * * *', scheduledTime: Date.UTC(2026, 10, 25, 21, 40) }

function runsResponse(runs: { status: string, conclusion: string | null }[]): Response {
  return Response.json({ total_count: runs.length, workflow_runs: runs })
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('scheduled 主觸發（05:00）', () => {
  it('對 main 分支的 daily.yml 發出 workflow_dispatch', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    await worker.scheduled(primary, env)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(DISPATCH_URL, { method: 'POST', headers, body: '{"ref":"main"}' })
  })

  it('5xx 時重試，後續成功就不丟錯', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('busy', { status: 502 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    const done = worker.scheduled(primary, env)
    await vi.runAllTimersAsync()
    await done

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('網路錯誤時重試', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('network'))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    const done = worker.scheduled(primary, env)
    await vi.runAllTimersAsync()
    await done

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('重試用完仍 5xx 就丟錯，讓 Cron 事件記成失敗', async () => {
    const fetchMock = vi.fn(async () => new Response('busy', { status: 503 }))
    vi.stubGlobal('fetch', fetchMock)

    const done = expect(worker.scheduled(primary, env)).rejects.toThrow('503')
    await vi.runAllTimersAsync()
    await done
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('4xx 不重試，直接丟錯', async () => {
    const fetchMock = vi.fn(async () => new Response('Not Found', { status: 404 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(worker.scheduled(primary, env)).rejects.toThrow('404')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('scheduled 備援（05:40）', () => {
  it('查詢主觸發之後建立的 run', async () => {
    const fetchMock = vi.fn(async () => runsResponse([{ status: 'completed', conclusion: 'success' }]))
    vi.stubGlobal('fetch', fetchMock)

    await worker.scheduled(backup, env)

    expect(fetchMock).toHaveBeenCalledWith(
      `${RUNS_URL}?created=%3E%3D2026-11-25T20%3A55%3A00.000Z&per_page=100`,
      { method: 'GET', headers },
    )
  })

  it.each([
    ['completed', 'success'],
    ['in_progress', null],
    ['queued', null],
  ])('已有 %s／%s 的 run 時不 dispatch', async (status, conclusion) => {
    const fetchMock = vi.fn(async () => runsResponse([{ status, conclusion }]))
    vi.stubGlobal('fetch', fetchMock)

    await worker.scheduled(backup, env)

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('沒有 run 時 dispatch', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(runsResponse([]))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    await worker.scheduled(backup, env)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenLastCalledWith(DISPATCH_URL, { method: 'POST', headers, body: '{"ref":"main"}' })
  })

  it('只有失敗或取消的 run 時 dispatch', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(runsResponse([
        { status: 'completed', conclusion: 'failure' },
        { status: 'completed', conclusion: 'cancelled' },
      ]))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    await worker.scheduled(backup, env)

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('查詢失敗時仍 dispatch，寧可多跑一次也不漏報告', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('Forbidden', { status: 403 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    await worker.scheduled(backup, env)

    expect(fetchMock).toHaveBeenLastCalledWith(DISPATCH_URL, { method: 'POST', headers, body: '{"ref":"main"}' })
  })
})
