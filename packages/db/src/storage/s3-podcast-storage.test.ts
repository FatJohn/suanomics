import type { SignedFetch } from './s3-podcast-storage.js'
import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import { S3PodcastStorage } from './s3-podcast-storage.js'

const CONFIG = {
  endpoint: 'https://acct.r2.cloudflarestorage.com',
  bucket: 'podcast-audio',
  accessKeyId: 'AKID',
  secretAccessKey: 'SECRET',
  region: 'auto',
  publicBaseUrl: 'https://pub-xyz.r2.dev',
}

interface Call { url: string, method: string, body?: Buffer, headers?: Record<string, string> }

function recordingFetch(status: number): { fetch: SignedFetch, calls: Call[] } {
  const calls: Call[] = []
  const fetch: SignedFetch = async (url, init) => {
    calls.push({ url, method: init.method, body: init.body, headers: init.headers })
    return { ok: status >= 200 && status < 300, status }
  }
  return { fetch, calls }
}

describe('s3PodcastStorage', () => {
  it('save() PUTs to bucket object url with audio/mpeg and returns key', async () => {
    const { fetch, calls } = recordingFetch(200)
    const storage = new S3PodcastStorage(CONFIG, fetch)
    const key = await storage.save('2026-06-16', Buffer.from('RIFFwav'))
    expect(key).toBe('podcast/2026-06-16.mp3')
    expect(calls).toHaveLength(1)
    /* eslint-disable ts/no-non-null-assertion -- calls[0] guaranteed by toHaveLength(1) above */
    expect(calls[0]!.method).toBe('PUT')
    expect(calls[0]!.url).toBe('https://acct.r2.cloudflarestorage.com/podcast-audio/podcast/2026-06-16.mp3')
    expect(calls[0]!.headers?.['content-type']).toBe('audio/mpeg')
    expect(calls[0]!.body?.toString()).toBe('RIFFwav')
    /* eslint-enable ts/no-non-null-assertion */
  })

  it('save() throws when PUT not ok', async () => {
    const { fetch } = recordingFetch(403)
    const storage = new S3PodcastStorage(CONFIG, fetch)
    await expect(storage.save('2026-06-16', Buffer.from('x'))).rejects.toThrow(/403/)
  })

  it('exists() HEADs and maps 200 -> true', async () => {
    const { fetch, calls } = recordingFetch(200)
    const storage = new S3PodcastStorage(CONFIG, fetch)
    expect(await storage.exists('2026-06-16')).toBe(true)
    // eslint-disable-next-line ts/no-non-null-assertion -- exists() records exactly one call
    expect(calls[0]!.method).toBe('HEAD')
  })

  it('exists() maps 404 -> false', async () => {
    const { fetch } = recordingFetch(404)
    const storage = new S3PodcastStorage(CONFIG, fetch)
    expect(await storage.exists('2026-06-16')).toBe(false)
  })

  it('urlFor() returns public url without hitting network', async () => {
    const { fetch, calls } = recordingFetch(500)
    const storage = new S3PodcastStorage(CONFIG, fetch)
    expect(await storage.urlFor('2026-06-16')).toBe('https://pub-xyz.r2.dev/podcast/2026-06-16.mp3')
    expect(calls).toHaveLength(0)
  })

  it('rejects invalid date format', async () => {
    const { fetch } = recordingFetch(200)
    const storage = new S3PodcastStorage(CONFIG, fetch)
    await expect(storage.save('notadate', Buffer.from('x'))).rejects.toThrow(/invalid date/)
  })
})
