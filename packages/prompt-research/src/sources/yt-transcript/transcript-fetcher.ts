import type { TranscriptSegment } from 'youtube-transcript-plus'
import { YoutubeTranscript } from 'youtube-transcript-plus'

interface RenderedSegment { offsetSec: number, text: string }

export interface FetchedTranscript {
  videoId: string
  text: string
  chars: number
  segments: RenderedSegment[]
}

// youtube-transcript-plus v2 回傳的 TranscriptSegment.offset 單位已是「秒」、
// 非舊版 v1 的 milliseconds、請勿再除 1000。
export async function fetchTranscript(videoId: string, lang = 'zh-TW'): Promise<FetchedTranscript> {
  const items: TranscriptSegment[] = await YoutubeTranscript.fetchTranscript(videoId, { lang })
  const segments: RenderedSegment[] = items
    .map<RenderedSegment>(it => ({
      offsetSec: Math.floor(it.offset),
      text: it.text.trim(),
    }))
    .filter((s: RenderedSegment) => s.text.length > 0)

  const text = segments
    .map((s: RenderedSegment) => `[${formatTimestamp(s.offsetSec)}] ${s.text}`)
    .join('\n')

  return { videoId, text, chars: text.length, segments }
}

function formatTimestamp(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`
}
