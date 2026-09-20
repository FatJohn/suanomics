import { Buffer } from 'node:buffer'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { _resetStorageCache, getPodcastStorage, LocalPodcastStorage } from './podcast-storage.js'
import { S3PodcastStorage } from './s3-podcast-storage.js'

describe('localPodcastStorage', () => {
  let baseDir: string
  let storage: LocalPodcastStorage

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'podcast-storage-test-'))
    storage = new LocalPodcastStorage(baseDir)
  })

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true })
  })

  it('save() writes file and returns relative storage path', async () => {
    const path = await storage.save('2026-04-30', Buffer.from('audio-data'))
    expect(path).toBe('2026-04-30.mp3')
  })

  it('exists() returns true after save', async () => {
    await storage.save('2026-04-30', Buffer.from('x'))
    expect(await storage.exists('2026-04-30')).toBe(true)
  })

  it('exists() returns false when file not saved', async () => {
    expect(await storage.exists('2026-04-30')).toBe(false)
  })

  it('urlFor() returns public URL when file exists', async () => {
    await storage.save('2026-04-30', Buffer.from('x'))
    expect(await storage.urlFor('2026-04-30')).toBe('/audio/podcast/2026-04-30.mp3')
  })

  it('urlFor() returns null when file missing', async () => {
    expect(await storage.urlFor('2026-04-30')).toBeNull()
  })

  it('save() creates baseDir if not exists', async () => {
    rmSync(baseDir, { recursive: true, force: true })
    await storage.save('2026-04-30', Buffer.from('x'))
    expect(await storage.exists('2026-04-30')).toBe(true)
  })

  it('readFilePath() returns absolute path for serving', () => {
    expect(storage.readFilePath('2026-04-30')).toBe(join(baseDir, '2026-04-30.mp3'))
  })
})

describe('getPodcastStorage env branching', () => {
  const S3_ENV = {
    PODCAST_STORAGE_KIND: 's3',
    PODCAST_S3_ENDPOINT: 'https://acct.r2.cloudflarestorage.com',
    PODCAST_S3_BUCKET: 'podcast-audio',
    PODCAST_S3_ACCESS_KEY_ID: 'AKID',
    PODCAST_S3_SECRET_ACCESS_KEY: 'SECRET',
    PODCAST_S3_REGION: 'auto',
    PODCAST_S3_PUBLIC_BASE_URL: 'https://pub-xyz.r2.dev',
  }

  afterEach(() => {
    _resetStorageCache()
    for (const k of Object.keys(S3_ENV))
      delete process.env[k]
  })

  it('defaults to LocalPodcastStorage when kind unset', () => {
    _resetStorageCache()
    expect(getPodcastStorage()).not.toBeInstanceOf(S3PodcastStorage)
  })

  it('returns S3PodcastStorage when kind=s3', () => {
    _resetStorageCache()
    Object.assign(process.env, S3_ENV)
    expect(getPodcastStorage()).toBeInstanceOf(S3PodcastStorage)
  })

  it('s3 requires PODCAST_S3_PUBLIC_BASE_URL', () => {
    _resetStorageCache()
    Object.assign(process.env, S3_ENV)
    delete process.env.PODCAST_S3_PUBLIC_BASE_URL
    expect(() => getPodcastStorage()).toThrow(/PODCAST_S3_PUBLIC_BASE_URL/)
  })
})
