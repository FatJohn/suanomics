import type { Buffer } from 'node:buffer'
import type { S3PodcastStorageConfig } from './s3-podcast-storage.js'
import { constants } from 'node:fs'
import { access, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import { PODCAST_AUDIO_EXT } from './podcast-audio-format.js'
import { S3PodcastStorage } from './s3-podcast-storage.js'

// Storage abstraction for podcast audio files.
// Two implementations, picked by PODCAST_STORAGE_KIND:
//   local — LocalPodcastStorage, container-local FS, wiped on every redeploy (dev default).
//   s3    — S3PodcastStorage, any S3-compatible bucket; the deployed setup uses Cloudflare R2.
export interface PodcastStorage {
  // Persist audio. Returns storage-internal path (stored in DB).
  save: (date: string, audio: Buffer) => Promise<string>
  // Public URL for frontend `<audio>` src; null if file missing.
  urlFor: (date: string) => Promise<string | null>
  exists: (date: string) => Promise<boolean>
}

const FILENAME_RE = /^\d{4}-\d{2}-\d{2}$/

function assertValidDate(date: string): void {
  if (!FILENAME_RE.test(date))
    throw new Error(`invalid date format: ${date}`)
}

export class LocalPodcastStorage implements PodcastStorage {
  constructor(private readonly baseDir: string) {}

  async save(date: string, audio: Buffer): Promise<string> {
    assertValidDate(date)
    await mkdir(this.baseDir, { recursive: true })
    const filename = `${date}.${PODCAST_AUDIO_EXT}`
    await writeFile(resolve(this.baseDir, filename), audio)
    return filename
  }

  async exists(date: string): Promise<boolean> {
    assertValidDate(date)
    try {
      await access(resolve(this.baseDir, `${date}.${PODCAST_AUDIO_EXT}`), constants.R_OK)
      return true
    }
    catch {
      return false
    }
  }

  async urlFor(date: string): Promise<string | null> {
    return (await this.exists(date)) ? `/audio/podcast/${date}.${PODCAST_AUDIO_EXT}` : null
  }

  // For audio route to read & stream the file. Not part of the interface
  // (S3 impl wouldn't use local FS reads); LocalPodcastStorage-specific.
  readFilePath(date: string): string {
    assertValidDate(date)
    return resolve(this.baseDir, `${date}.${PODCAST_AUDIO_EXT}`)
  }
}

let cached: PodcastStorage | null = null

// Singleton factory。PODCAST_STORAGE_KIND=s3 走 R2、其餘走 local（PoC dev 預設）。
export function getPodcastStorage(): PodcastStorage {
  if (cached)
    return cached
  const kind = process.env.PODCAST_STORAGE_KIND ?? 'local'
  if (kind === 's3') {
    cached = new S3PodcastStorage(readS3ConfigFromEnv())
    return cached
  }
  const baseDir = resolve(process.cwd(), '.audio-cache/podcast')
  cached = new LocalPodcastStorage(baseDir)
  return cached
}

// 從 env 組 R2 config。urlFor 只需 publicBaseUrl（api / worker 都要）；
// PUT/HEAD 用的 creds 在 api 端可缺省（api 只呼叫 urlFor、不寫不查存在）。
function readS3ConfigFromEnv(): S3PodcastStorageConfig {
  const publicBaseUrl = process.env.PODCAST_S3_PUBLIC_BASE_URL
  if (!publicBaseUrl)
    throw new Error('getPodcastStorage: PODCAST_STORAGE_KIND=s3 requires env PODCAST_S3_PUBLIC_BASE_URL')
  return {
    endpoint: (process.env.PODCAST_S3_ENDPOINT ?? '').replace(/\/+$/, ''),
    bucket: process.env.PODCAST_S3_BUCKET ?? '',
    accessKeyId: process.env.PODCAST_S3_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.PODCAST_S3_SECRET_ACCESS_KEY ?? '',
    region: process.env.PODCAST_S3_REGION ?? 'auto',
    publicBaseUrl: publicBaseUrl.replace(/\/+$/, ''),
  }
}

// For testing: reset singleton between tests if needed.
export function _resetStorageCache(): void {
  cached = null
}
