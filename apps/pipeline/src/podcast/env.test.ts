import { describe, expect, it } from 'vitest'
import { readPodcastEnv } from './env.js'

const FULL = {
  AZURE_SPEECH_KEY: 'k',
  AZURE_SPEECH_REGION: 'eastasia',
  CLOUDFLARE_ACCOUNT_ID: 'acc',
  R2_ACCESS_KEY_ID: 'ak',
  R2_SECRET_ACCESS_KEY: 'sk',
  R2_BUCKET: 'suanomics-podcast',
  R2_PUBLIC_BASE_URL: 'https://audio.example.com/',
}

describe('readPodcastEnv', () => {
  it('讀齊設定，公開網址去掉結尾斜線', () => {
    expect(readPodcastEnv(FULL)).toEqual({
      azure: { key: 'k', region: 'eastasia' },
      r2: { accountId: 'acc', accessKeyId: 'ak', secretAccessKey: 'sk', bucket: 'suanomics-podcast' },
      publicBaseUrl: 'https://audio.example.com',
    })
  })

  it('缺任何一個就一次列出全部缺的 key', () => {
    expect(() => readPodcastEnv({ ...FULL, AZURE_SPEECH_KEY: '', R2_BUCKET: undefined })).toThrow('AZURE_SPEECH_KEY、R2_BUCKET')
  })

  it('公開網址不是 https 時拒絕', () => {
    expect(() => readPodcastEnv({ ...FULL, R2_PUBLIC_BASE_URL: 'http://audio.example.com' })).toThrow(/https/)
  })
})
