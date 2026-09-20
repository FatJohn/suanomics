import type { TranscriptSegment } from 'youtube-transcript-plus'
import { YoutubeTranscript } from 'youtube-transcript-plus'

// 11 個字元的 YouTube video id：英數 + _ + -
const VIDEO_ID_PATTERN = /^[\w-]{11}$/

export function extractVideoId(url: string): string | null {
  if (!url)
    return null
  let parsed: URL
  try {
    parsed = new URL(url)
  }
  catch {
    return null
  }

  const host = parsed.hostname.toLowerCase()

  // youtu.be/{id}
  if (host === 'youtu.be') {
    const id = parsed.pathname.replace(/^\//, '')
    return VIDEO_ID_PATTERN.test(id) ? id : null
  }

  // youtube.com / www.youtube.com / m.youtube.com
  if (host === 'youtube.com' || host === 'www.youtube.com' || host === 'm.youtube.com') {
    // /watch?v={id}
    if (parsed.pathname === '/watch') {
      const id = parsed.searchParams.get('v') ?? ''
      return VIDEO_ID_PATTERN.test(id) ? id : null
    }
    // /shorts/{id} or /live/{id}（直播存檔）
    const pathMatch = parsed.pathname.match(/^\/(?:shorts|live)\/([\w-]+)/)
    if (pathMatch) {
      const id = pathMatch[1] ?? ''
      return VIDEO_ID_PATTERN.test(id) ? id : null
    }
  }

  return null
}

export type YoutubeErrorReason = 'no_transcript' | 'not_found' | 'fetch_failed'

export class YoutubeError extends Error {
  public readonly reason: YoutubeErrorReason

  constructor(reason: YoutubeErrorReason, message: string) {
    super(message)
    this.name = 'YoutubeError'
    this.reason = reason
  }
}

export interface TranscriptResult {
  transcript: string
  language: string
  originalLength: number
}

// 語系優先：zh-TW → zh-CN → en。套件若未抓到指定語系字幕、會 throw；
// 三者皆無時、捕最後一個 error 做分類、視同 no_transcript。
const LANGUAGE_PRIORITY = ['zh-TW', 'zh-CN', 'en'] as const

// 透過 error message 字串分類、兼容 youtube-transcript 和 youtube-transcript-plus：
// - Transcripts? (is|are) disabled：兩套件的 "Transcript is disabled" / "Transcripts are disabled"
// - No transcripts? are available：兩套件的 NotAvailable + NotAvailableLanguage 類別
// - is no longer available：youtube-transcript-plus 的 VideoUnavailableError
// - Invalid YouTube video ID：youtube-transcript-plus 的 InvalidVideoIdError（視同 not_found）
function classifyError(err: unknown): YoutubeErrorReason {
  const msg = err instanceof Error ? err.message : String(err)
  if (/Transcripts? (?:is|are) disabled|No transcripts? are available|transcript.*not.*available/i.test(msg))
    return 'no_transcript'
  if (/Video unavailable|video not found|is no longer available|Invalid YouTube video ID/i.test(msg))
    return 'not_found'
  return 'fetch_failed'
}

export async function fetchTranscript(videoId: string): Promise<TranscriptResult> {
  let lastError: unknown = null
  for (const lang of LANGUAGE_PRIORITY) {
    try {
      const segments: TranscriptSegment[] = await YoutubeTranscript.fetchTranscript(videoId, { lang })
      const transcript = segments.map(s => s.text).join('\n')
      // 某些影片 captionTracks 存在但實際 <p> 標籤為空、segments=[] → transcript=''、
      // 送進 LLM 查核會失準、視同 no_transcript 讓外層 classify。
      if (!transcript)
        throw new Error('No transcripts are available')
      const language = segments[0]?.lang ?? lang
      return {
        transcript,
        language,
        originalLength: transcript.length,
      }
    }
    catch (err) {
      lastError = err
      // 影片不存在 / id 無效、試其他語系是浪費、且後續 error 可能誤分類成別的 reason。
      if (classifyError(err) === 'not_found')
        break
      continue
    }
  }
  const reason = classifyError(lastError)
  const msg = lastError instanceof Error ? lastError.message : 'unknown'
  throw new YoutubeError(reason, `fetchTranscript failed: ${msg}`)
}
