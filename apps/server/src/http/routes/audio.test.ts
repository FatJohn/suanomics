import { Buffer } from 'node:buffer'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('audio route', () => {
  let baseDir: string
  let app: Hono

  beforeEach(async () => {
    vi.resetModules()
    baseDir = mkdtempSync(join(tmpdir(), 'audio-route-test-'))
    mkdirSync(join(baseDir, '.audio-cache/podcast'), { recursive: true })
    vi.spyOn(process, 'cwd').mockReturnValue(baseDir)

    const { _resetStorageCache } = await import('@suanomics/db/storage/podcast-storage')
    _resetStorageCache()
    const { audioRoute } = await import('./audio.js')
    app = new Hono()
    app.route('/', audioRoute)
  })

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('serves mp3 file with correct Content-Type', async () => {
    writeFileSync(join(baseDir, '.audio-cache/podcast/2026-04-30.mp3'), Buffer.from('RIFFwavedata'))
    const res = await app.request('/audio/podcast/2026-04-30.mp3')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('audio/mpeg')
    const body = Buffer.from(await res.arrayBuffer())
    expect(body.toString('ascii')).toBe('RIFFwavedata')
  })

  it('returns 404 when file does not exist', async () => {
    const res = await app.request('/audio/podcast/2026-04-30.mp3')
    expect(res.status).toBe(404)
  })

  it('rejects invalid date format', async () => {
    const res = await app.request('/audio/podcast/notadate.mp3')
    expect(res.status).toBe(400)
  })

  it('rejects path traversal attempts', async () => {
    const res = await app.request('/audio/podcast/..%2F..%2Fetc%2Fpasswd.mp3')
    expect([400, 404]).toContain(res.status)
  })
})

describe('audio route - s3 storage', () => {
  const S3_ENV = {
    PODCAST_STORAGE_KIND: 's3',
    PODCAST_S3_PUBLIC_BASE_URL: 'https://pub-xyz.r2.dev',
  }
  let app: Hono

  beforeEach(async () => {
    vi.resetModules()
    Object.assign(process.env, S3_ENV)
    const { _resetStorageCache } = await import('@suanomics/db/storage/podcast-storage')
    _resetStorageCache()
    const { audioRoute } = await import('./audio.js')
    app = new Hono()
    app.route('/', audioRoute)
  })

  afterEach(async () => {
    const { _resetStorageCache } = await import('@suanomics/db/storage/podcast-storage')
    _resetStorageCache()
    for (const k of Object.keys(S3_ENV))
      delete process.env[k]
    vi.restoreAllMocks()
  })

  it('redirects to R2 public url (302) without hitting storage', async () => {
    const res = await app.request('/audio/podcast/2026-06-16.mp3', { redirect: 'manual' })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('https://pub-xyz.r2.dev/podcast/2026-06-16.mp3')
  })

  it('still rejects invalid date in s3 mode', async () => {
    const res = await app.request('/audio/podcast/notadate.mp3', { redirect: 'manual' })
    expect(res.status).toBe(400)
  })
})
