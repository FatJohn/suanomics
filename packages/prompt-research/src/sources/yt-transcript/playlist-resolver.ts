export interface VideoRef {
  videoId: string
  title: string
  url: string
  publishedAt: string
  durationSec: number
}

export interface SelectionFlags {
  count?: number | 'all'
  range?: [number, number]
  videoIds?: string[]
}

const DEFAULT_COUNT = 7

export function parseStreamsHtml(html: string): VideoRef[] {
  const match = html.match(/var\s+ytInitialData\s*=\s*(\{[\s\S]+?\});/)
  if (!match || !match[1])
    return []

  let data: unknown

  try {
    data = JSON.parse(match[1])
  }
  catch {
    return []
  }

  const videos: VideoRef[] = []
  walk(data, videos)
  return videos
}

function walk(node: unknown, out: VideoRef[]): void {
  if (node === null || typeof node !== 'object')
    return

  if (Array.isArray(node)) {
    for (const item of node) walk(item, out)
    return
  }

  const obj = node as Record<string, unknown>

  // 新結構（2026 中起）：YouTube 以 lockupViewModel 取代 videoRenderer
  if (isObject(obj.lockupViewModel)) {
    const video = parseLockupViewModel(obj.lockupViewModel)
    if (video)
      out.push(video)
  }
  // 舊結構 fallback：videoRenderer（向後相容、保留舊 fixture 可解）
  else if (isObject(obj.videoRenderer)) {
    const video = obj.videoRenderer
    const videoId = typeof video.videoId === 'string' ? video.videoId : null
    const title = extractText(video.title)
    const duration = parseDuration(extractText(video.lengthText))
    const publishedText = extractText(video.publishedTimeText)

    if (videoId && title) {
      out.push({
        videoId,
        title,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        publishedAt: estimatePublishedAt(publishedText),
        durationSec: duration,
      })
    }
  }

  for (const key of Object.keys(obj)) {
    walk(obj[key], out)
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseLockupViewModel(lockup: Record<string, unknown>): VideoRef | null {
  // 只收影片型 lockup（排除 playlist / channel 等其他 contentType）
  if (lockup.contentType !== 'LOCKUP_CONTENT_TYPE_VIDEO')
    return null

  const videoId = typeof lockup.contentId === 'string' ? lockup.contentId : null
  if (!videoId)
    return null

  const title = extractLockupTitle(lockup.metadata)
  if (!title)
    return null

  return {
    videoId,
    title,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    publishedAt: estimatePublishedAt(extractLockupPublishedText(lockup.metadata)),
    durationSec: parseDuration(extractLockupDuration(lockup.contentImage)),
  }
}

function extractLockupTitle(metadata: unknown): string {
  if (!isObject(metadata))
    return ''
  const meta = metadata.lockupMetadataViewModel
  if (!isObject(meta) || !isObject(meta.title))
    return ''
  return typeof meta.title.content === 'string' ? meta.title.content : ''
}

function extractLockupPublishedText(metadata: unknown): string {
  if (!isObject(metadata))
    return ''
  const meta = metadata.lockupMetadataViewModel
  if (!isObject(meta) || !isObject(meta.metadata))
    return ''
  const cmv = meta.metadata.contentMetadataViewModel
  if (!isObject(cmv) || !Array.isArray(cmv.metadataRows))
    return ''

  for (const row of cmv.metadataRows) {
    if (!isObject(row) || !Array.isArray(row.metadataParts))
      continue
    for (const part of row.metadataParts) {
      if (!isObject(part) || !isObject(part.text))
        continue
      const content = typeof part.text.content === 'string' ? part.text.content : ''
      // 觀看次數那欄沒有時間關鍵字、只取含「前 / ago」的那欄
      if (/前|ago/.test(content))
        return content
    }
  }
  return ''
}

function extractLockupDuration(contentImage: unknown): string {
  if (!isObject(contentImage))
    return ''
  const tvm = contentImage.thumbnailViewModel
  if (!isObject(tvm) || !Array.isArray(tvm.overlays))
    return ''

  for (const overlay of tvm.overlays) {
    if (!isObject(overlay))
      continue
    const bottom = overlay.thumbnailBottomOverlayViewModel
    if (!isObject(bottom) || !Array.isArray(bottom.badges))
      continue
    for (const badge of bottom.badges) {
      if (!isObject(badge))
        continue
      const bvm = badge.thumbnailBadgeViewModel
      if (isObject(bvm) && typeof bvm.text === 'string')
        return bvm.text
    }
  }
  return ''
}

function extractText(value: unknown): string {
  if (typeof value === 'string')
    return value

  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>

    if (typeof obj.simpleText === 'string')
      return obj.simpleText

    if (Array.isArray(obj.runs)) {
      return (obj.runs as Array<{ text?: string }>)
        .map(run => run.text ?? '')
        .join('')
    }
  }

  return ''
}

function parseDuration(text: string): number {
  const parts = text.split(':').map(part => Number.parseInt(part, 10))
  if (parts.some(Number.isNaN))
    return 0

  if (parts.length === 3)
    // eslint-disable-next-line ts/no-non-null-assertion -- length === 3 guarantees indices 0,1,2 exist
    return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!
  if (parts.length === 2)
    // eslint-disable-next-line ts/no-non-null-assertion -- length === 2 guarantees indices 0,1 exist
    return parts[0]! * 60 + parts[1]!

  return 0
}

function estimatePublishedAt(text: string): string {
  const now = new Date()
  // 同時支援英文（X hour/day ago）與繁中（X 小時前 / X 天前）
  const hourMatch = text.match(/(\d+)\s*(?:hour|小時)/)
  const dayMatch = text.match(/(\d+)\s*(?:day|天)/)

  if (hourMatch) {
    // eslint-disable-next-line ts/no-non-null-assertion -- hourMatch is non-null (if branch), capture group 1 exists
    now.setHours(now.getHours() - Number.parseInt(hourMatch[1]!, 10))
  }
  else if (dayMatch) {
    // eslint-disable-next-line ts/no-non-null-assertion -- dayMatch is non-null (else-if branch), capture group 1 exists
    now.setDate(now.getDate() - Number.parseInt(dayMatch[1]!, 10))
  }

  return now.toISOString()
}

export function applySelectionFlags(
  videos: readonly VideoRef[],
  flags: SelectionFlags,
): VideoRef[] {
  const sorted = [...videos].sort((a, b) =>
    b.publishedAt.localeCompare(a.publishedAt),
  )

  if (flags.videoIds && flags.videoIds.length > 0) {
    const ids = new Set(flags.videoIds)
    return sorted.filter(video => ids.has(video.videoId))
  }

  if (flags.range) {
    const [start, end] = flags.range
    return sorted.slice(start, end + 1)
  }

  const count = flags.count ?? DEFAULT_COUNT
  if (count === 'all')
    return sorted

  return sorted.slice(0, count)
}

export async function fetchStreamsPage(playlistUrl: string): Promise<string> {
  const response = await fetch(playlistUrl, {
    headers: {
      'user-agent': 'Mozilla/5.0 suanomics/1.0',
      'accept-language': 'zh-TW',
    },
  })

  if (!response.ok) {
    throw new Error(`YT streams page HTTP ${response.status}`)
  }

  return response.text()
}
