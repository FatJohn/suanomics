import type { R2Fetch } from './r2-upload.js'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { putR2Object, signS3Request } from './r2-upload.js'

describe('signS3Request', () => {
  // AWS 文件 Signature Version 4 header 驗證的「Example: GET Object」範例值。
  it('與 AWS 官方範例的簽章一致', () => {
    const authorization = signS3Request({
      method: 'GET',
      url: 'https://examplebucket.s3.amazonaws.com/test.txt',
      headers: {
        'range': 'bytes=0-9',
        'x-amz-content-sha256': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        'x-amz-date': '20130524T000000Z',
      },
      region: 'us-east-1',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    })
    expect(authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request,'
      + 'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date,'
      + 'Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    )
  })
})

interface Call { url: string, method: string, headers: Record<string, string>, body: Uint8Array }
function recordingFetch(status: number): { fetch: R2Fetch, calls: Call[] } {
  const calls: Call[] = []
  const fetch: R2Fetch = async (url, init) => {
    calls.push({ url, ...init })
    return { ok: status >= 200 && status < 300, status, text: async () => 'err-body' }
  }
  return { fetch, calls }
}

describe('putR2Object', () => {
  const config = { accountId: 'acc123', bucket: 'suanomics-podcast', accessKeyId: 'AK', secretAccessKey: 'SK' }
  const body = Buffer.from([0xFF, 0xFB, 0x01])

  it('pUT 到 R2 的 S3 端點，帶內容雜湊與 auto region 的簽章', async () => {
    const { fetch, calls } = recordingFetch(200)
    await putR2Object(config, { key: 'podcasts/2026-11-26.mp3', body, contentType: 'audio/mpeg' }, fetch, new Date('2026-11-26T01:02:03Z'))
    expect(calls).toHaveLength(1)
    const call = calls[0]
    expect(call?.url).toBe('https://acc123.r2.cloudflarestorage.com/suanomics-podcast/podcasts/2026-11-26.mp3')
    expect(call?.method).toBe('PUT')
    expect(call?.body).toEqual(body)
    expect(call?.headers).toMatchObject({
      'content-type': 'audio/mpeg',
      'x-amz-date': '20261126T010203Z',
      'x-amz-content-sha256': createHash('sha256').update(body).digest('hex'),
    })
    expect(call?.headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AK\/20261126\/auto\/s3\/aws4_request,SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date,Signature=[0-9a-f]{64}$/)
  })

  it('非 2xx 時丟錯並帶狀態碼', async () => {
    const { fetch } = recordingFetch(403)
    await expect(putR2Object(config, { key: 'k.mp3', body, contentType: 'audio/mpeg' }, fetch)).rejects.toThrow(/403/)
  })
})
