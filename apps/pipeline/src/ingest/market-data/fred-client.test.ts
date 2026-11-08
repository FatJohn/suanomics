import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchFredObservations } from './fred-client.js'

function okJson(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 })
}

afterEach(() => vi.unstubAllGlobals())

describe('fetchFredObservations', () => {
  it('parses observations and skips missing values (".")', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okJson({
      observations: [
        { date: '2026-06-11', value: '4.32' },
        { date: '2026-06-10', value: '.' },
        { date: '2026-06-09', value: '4.28' },
      ],
    })))
    const out = await fetchFredObservations({ fredId: 'DGS10', apiKey: 'k', limit: 10 })
    expect(out).toEqual([
      { date: '2026-06-09', value: 4.28 },
      { date: '2026-06-11', value: 4.32 },
    ]) // 升冪、缺值跳過
  })

  it('throws on non-200', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 403 })))
    await expect(fetchFredObservations({ fredId: 'DGS10', apiKey: 'bad', limit: 5 })).rejects.toThrow(/403/)
  })

  // 另外三個 source client 都把 AbortError 換成帶 label 的具名 timeout，只有 fred 沒有，
  // 所以同一種故障在 log 裡有兩種長相（FRED 印裸的 "This operation was aborted"）。
  it('wraps AbortError into a timeout message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      const e = new Error('aborted')
      e.name = 'AbortError'
      throw e
    }))
    await expect(fetchFredObservations({ fredId: 'DGS10', apiKey: 'k', limit: 5, timeoutMs: 5 }))
      .rejects
      .toThrow(/fred-client: DGS10 timeout after 5ms/)
  })

  it('builds correct URL with api key + sort desc + limit', async () => {
    const spy = vi.fn(async () => okJson({ observations: [] }))
    vi.stubGlobal('fetch', spy)
    await fetchFredObservations({ fredId: 'CPIAUCSL', apiKey: 'secret', limit: 15 })
    const url = String(spy.mock.calls[0]?.[0])
    expect(url).toContain('series_id=CPIAUCSL')
    expect(url).toContain('api_key=secret')
    expect(url).toContain('sort_order=desc')
    expect(url).toContain('limit=15')
  })
})
