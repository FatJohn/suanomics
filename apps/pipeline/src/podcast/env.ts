import type { R2Config } from './r2-upload.js'

export interface PodcastEnv {
  azure: { key: string, region: string }
  r2: R2Config
  publicBaseUrl: string
}

const KEYS = ['AZURE_SPEECH_KEY', 'AZURE_SPEECH_REGION', 'CLOUDFLARE_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'R2_PUBLIC_BASE_URL'] as const

// 在寫稿（花 LLM 費用）之前就檢查，避免稿子寫完才發現傳不上去。
export function readPodcastEnv(env: Record<string, string | undefined>): PodcastEnv {
  const missing = KEYS.filter(k => !env[k])
  if (missing.length > 0)
    throw new Error(`podcast 缺環境變數：${missing.join('、')}`)
  const get = (k: typeof KEYS[number]): string => env[k] ?? ''
  const publicBaseUrl = get('R2_PUBLIC_BASE_URL').replace(/\/+$/, '')
  if (!publicBaseUrl.startsWith('https://'))
    throw new Error(`R2_PUBLIC_BASE_URL 必須是 https 網址，收到 ${publicBaseUrl}`)
  return {
    azure: { key: get('AZURE_SPEECH_KEY'), region: get('AZURE_SPEECH_REGION') },
    r2: { accountId: get('CLOUDFLARE_ACCOUNT_ID'), accessKeyId: get('R2_ACCESS_KEY_ID'), secretAccessKey: get('R2_SECRET_ACCESS_KEY'), bucket: get('R2_BUCKET') },
    publicBaseUrl,
  }
}
