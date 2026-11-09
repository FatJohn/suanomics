import { afterEach, describe, expect, it, vi } from 'vitest'
import worker from './index.js'

const env = { GITHUB_DISPATCH_TOKEN: 'test-token' }

afterEach(() => vi.unstubAllGlobals())

describe('scheduled', () => {
  it('對 rewrite 分支的 daily.yml 發出 workflow_dispatch', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    await worker.scheduled({}, env)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/FatJohn/suanomics/actions/workflows/daily.yml/dispatches',
      {
        method: 'POST',
        headers: {
          'Accept': 'application/vnd.github+json',
          'Authorization': 'Bearer test-token',
          'User-Agent': 'suanomics-trigger',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: '{"ref":"rewrite"}',
      },
    )
  })

  it('回應非 2xx 時丟錯，讓 Cron 事件記成失敗', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Not Found', { status: 404 })))

    await expect(worker.scheduled({}, env)).rejects.toThrow('404')
  })
})
