import type { Buffer } from 'node:buffer'
import { createHash, createHmac } from 'node:crypto'

// R2 的 S3 相容 API 用 SigV4 簽章；只需要單一 PUT，自己簽比引入 SDK 輕。

function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

function hmac(key: string | Buffer, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest()
}

function encodeRfc3986(segment: string): string {
  return encodeURIComponent(segment).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}

export interface SignS3RequestInput {
  method: string
  url: string
  /** 小寫 header 名稱，須含 x-amz-date 與 x-amz-content-sha256；host 由 url 推得。 */
  headers: Record<string, string>
  region: string
  accessKeyId: string
  secretAccessKey: string
}

/** 回傳 Authorization header 值。只處理沒有 query string 的請求。 */
export function signS3Request(input: SignS3RequestInput): string {
  const url = new URL(input.url)
  const amzDate = input.headers['x-amz-date'] ?? ''
  const payloadHash = input.headers['x-amz-content-sha256'] ?? ''
  const day = amzDate.slice(0, 8)
  const headers: Record<string, string> = { ...input.headers, host: url.host }
  const names = Object.keys(headers).sort()
  const signedHeaders = names.join(';')
  const canonicalUri = url.pathname.split('/').map(s => encodeRfc3986(decodeURIComponent(s))).join('/')
  const canonicalRequest = [
    input.method,
    canonicalUri,
    '',
    ...names.map(n => `${n}:${(headers[n] ?? '').trim()}`),
    '',
    signedHeaders,
    payloadHash,
  ].join('\n')
  const scope = `${day}/${input.region}/s3/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n')
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${input.secretAccessKey}`, day), input.region), 's3'), 'aws4_request')
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex')
  return `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope},SignedHeaders=${signedHeaders},Signature=${signature}`
}

export interface R2Config {
  accountId: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
}

export interface R2Object {
  key: string
  body: Uint8Array
  contentType: string
}

export type R2Fetch = (
  url: string,
  init: { method: string, headers: Record<string, string>, body: Uint8Array },
) => Promise<{ ok: boolean, status: number, text: () => Promise<string> }>

const defaultFetch: R2Fetch = async (url, init) => {
  const r = await fetch(url, { ...init, body: new Uint8Array(init.body) })
  return { ok: r.ok, status: r.status, text: () => r.text() }
}

function toAmzDate(now: Date): string {
  return now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

export async function putR2Object(config: R2Config, object: R2Object, fetchImpl: R2Fetch = defaultFetch, now: Date = new Date()): Promise<void> {
  const url = `https://${config.accountId}.r2.cloudflarestorage.com/${config.bucket}/${object.key}`
  const headers: Record<string, string> = {
    'content-type': object.contentType,
    'x-amz-content-sha256': sha256Hex(object.body),
    'x-amz-date': toAmzDate(now),
  }
  const authorization = signS3Request({ method: 'PUT', url, headers, region: 'auto', accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey })
  const res = await fetchImpl(url, { method: 'PUT', headers: { ...headers, authorization }, body: object.body })
  if (!res.ok)
    throw new Error(`R2 PUT ${object.key} HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
}
