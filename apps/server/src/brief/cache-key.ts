import { createHash } from 'node:crypto'

export interface AnalyzeInput {
  url?: string
  title: string
  content: string
}

export function normalizeUrl(raw: string): string {
  const u = new URL(raw)
  u.hash = ''
  for (const k of [...u.searchParams.keys()]) {
    if (k.toLowerCase().startsWith('utm_'))
      u.searchParams.delete(k)
  }
  // 簡化：拿掉單一 trailing slash（cache 命中率優先）
  return u.toString().replace(/\/$/, '')
}

export function computeInputHash(input: AnalyzeInput): string {
  const text = input.url
    ? normalizeUrl(input.url)
    : `${input.title}\n${input.content}`
  return createHash('sha256').update(text).digest('hex')
}

export function computeInputUrl(input: AnalyzeInput): string | null {
  return input.url ? normalizeUrl(input.url) : null
}
