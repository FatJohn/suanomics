import type { Buffer } from 'node:buffer'
import type { PodcastStorage } from './podcast-storage.js'
import { AwsClient } from 'aws4fetch'
import { PODCAST_AUDIO_CONTENT_TYPE, PODCAST_AUDIO_EXT } from './podcast-audio-format.js'

export interface S3PodcastStorageConfig {
  endpoint: string // 例 https://<account>.r2.cloudflarestorage.com（無尾斜線）
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  region: string // R2 用 'auto'
  publicBaseUrl: string // 例 https://pub-xyz.r2.dev（無尾斜線）
}

export interface SignedResponse {
  ok: boolean
  status: number
}

// 注入式簽章 fetch：只暴露用得到的欄位、避免依賴全域 DOM 型別、單測可塞假實作。
export type SignedFetch = (
  url: string,
  init: { method: string, body?: Buffer, headers?: Record<string, string> },
) => Promise<SignedResponse>

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function assertValidDate(date: string): void {
  if (!DATE_RE.test(date))
    throw new Error(`invalid date format: ${date}`)
}

export class S3PodcastStorage implements PodcastStorage {
  private readonly signedFetch: SignedFetch

  constructor(
    private readonly config: S3PodcastStorageConfig,
    signedFetch?: SignedFetch,
  ) {
    this.signedFetch = signedFetch ?? defaultSignedFetch(config)
  }

  private objectUrl(date: string): string {
    // R2 path-style：<endpoint>/<bucket>/<key>
    return `${this.config.endpoint}/${this.config.bucket}/podcast/${date}.${PODCAST_AUDIO_EXT}`
  }

  async save(date: string, audio: Buffer): Promise<string> {
    assertValidDate(date)
    const res = await this.signedFetch(this.objectUrl(date), {
      method: 'PUT',
      body: audio,
      headers: { 'content-type': PODCAST_AUDIO_CONTENT_TYPE },
    })
    if (!res.ok)
      throw new Error(`S3PodcastStorage.save failed for ${date}: HTTP ${res.status}`)
    return `podcast/${date}.${PODCAST_AUDIO_EXT}`
  }

  async exists(date: string): Promise<boolean> {
    assertValidDate(date)
    const res = await this.signedFetch(this.objectUrl(date), { method: 'HEAD' })
    return res.ok
  }

  // 回 canonical public URL（純組字串、不打網路、不需 creds）；存在性查詢用 exists()。
  async urlFor(date: string): Promise<string | null> {
    assertValidDate(date)
    return `${this.config.publicBaseUrl}/podcast/${date}.${PODCAST_AUDIO_EXT}`
  }
}

function defaultSignedFetch(config: S3PodcastStorageConfig): SignedFetch {
  const client = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    region: config.region,
    service: 's3',
  })
  return async (url, init) => {
    // Buffer 是 Uint8Array 的子型別、runtime 可當 BodyInit；明確建構 RequestInit
    // 才能在 exactOptionalPropertyTypes 下不把 optional 欄位塞成 undefined。
    const requestInit: RequestInit = { method: init.method }
    if (init.body !== undefined)
      requestInit.body = new Uint8Array(init.body)
    if (init.headers !== undefined)
      requestInit.headers = init.headers
    const res = await client.fetch(url, requestInit)
    return { ok: res.ok, status: res.status }
  }
}
