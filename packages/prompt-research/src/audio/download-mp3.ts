import { Buffer } from 'node:buffer'

export interface DownloadMp3Config {
  url: string
  /** default: 200 * 1024 * 1024 (200MB) — single podcast episode 通常 < 100MB */
  maxBytes?: number
  /** for tests */
  fetchImpl?: typeof fetch
  /** default: 60_000ms */
  timeoutMs?: number
}

export interface DownloadMp3Result {
  buffer: Buffer
  mimeType: string
  sizeBytes: number
}

const DEFAULT_MAX_BYTES = 200 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 60_000

export async function downloadMp3(cfg: DownloadMp3Config): Promise<DownloadMp3Result> {
  const fetchImpl = cfg.fetchImpl ?? fetch
  const maxBytes = cfg.maxBytes ?? DEFAULT_MAX_BYTES
  const timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS

  const res = await fetchImpl(cfg.url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'user-agent': 'suanomics-prompt-research/1.0' },
  })

  if (!res.ok)
    throw new Error(`mp3 download HTTP ${res.status}: ${cfg.url}`)

  const contentLength = res.headers.get('content-length')
  if (contentLength) {
    const declared = Number.parseInt(contentLength, 10)
    if (Number.isFinite(declared) && declared > maxBytes)
      throw new Error(`mp3 size (${declared} bytes) exceeds maxBytes (${maxBytes})`)
  }

  const arrayBuffer = await res.arrayBuffer()
  if (arrayBuffer.byteLength > maxBytes)
    throw new Error(`mp3 size (${arrayBuffer.byteLength} bytes) exceeds maxBytes (${maxBytes})`)

  const mimeType = res.headers.get('content-type')?.split(';')[0]?.trim() ?? 'audio/mpeg'

  return {
    buffer: Buffer.from(arrayBuffer),
    mimeType: mimeType || 'audio/mpeg',
    sizeBytes: arrayBuffer.byteLength,
  }
}
