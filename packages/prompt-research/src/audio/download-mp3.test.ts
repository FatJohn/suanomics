import { describe, expect, it, vi } from 'vitest'
import { downloadMp3 } from './download-mp3.js'

function makeFetchResponse(opts: {
  ok?: boolean
  status?: number
  headers?: Record<string, string>
  body?: Uint8Array
}): Response {
  return {
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    headers: {
      get(key: string) {
        return opts.headers?.[key.toLowerCase()] ?? null
      },
    },
    arrayBuffer: async () => (opts.body ?? new Uint8Array()).buffer,
  } as unknown as Response
}

describe('downloadMp3', () => {
  it('returns buffer + mimeType from successful fetch', async () => {
    const body = new Uint8Array([0x49, 0x44, 0x33]) // 'ID3' mp3 magic
    const fakeFetch = vi.fn().mockResolvedValue(
      makeFetchResponse({
        headers: { 'content-type': 'audio/mpeg', 'content-length': '3' },
        body,
      }),
    ) as unknown as typeof fetch

    const result = await downloadMp3({
      url: 'https://example.com/ep.mp3',
      fetchImpl: fakeFetch,
    })

    expect(result.buffer.length).toBe(3)
    expect(result.mimeType).toBe('audio/mpeg')
    expect(result.sizeBytes).toBe(3)
  })

  it('throws when Content-Length exceeds maxBytes', async () => {
    const fakeFetch = vi.fn().mockResolvedValue(
      makeFetchResponse({
        headers: { 'content-type': 'audio/mpeg', 'content-length': '999999999' },
      }),
    ) as unknown as typeof fetch

    await expect(downloadMp3({
      url: 'https://example.com/big.mp3',
      maxBytes: 1024,
      fetchImpl: fakeFetch,
    })).rejects.toThrow(/exceeds maxBytes/i)
  })

  it('throws on non-2xx', async () => {
    const fakeFetch = vi.fn().mockResolvedValue(
      makeFetchResponse({ ok: false, status: 404 }),
    ) as unknown as typeof fetch

    await expect(downloadMp3({
      url: 'https://example.com/missing.mp3',
      fetchImpl: fakeFetch,
    })).rejects.toThrow(/HTTP 404/)
  })

  it('falls back to audio/mpeg when no Content-Type', async () => {
    const fakeFetch = vi.fn().mockResolvedValue(
      makeFetchResponse({
        headers: {},
        body: new Uint8Array([0]),
      }),
    ) as unknown as typeof fetch

    const result = await downloadMp3({
      url: 'https://example.com/ep',
      fetchImpl: fakeFetch,
    })

    expect(result.mimeType).toBe('audio/mpeg')
  })
})
