import { beforeEach, describe, expect, it, vi } from 'vitest'
import { extractVideoId, fetchTranscript, YoutubeError } from './youtube.js'

describe('extractVideoId', () => {
  it('extracts id from youtu.be short URL', () => {
    expect(extractVideoId('https://youtu.be/abc12345678')).toBe('abc12345678')
  })

  it('extracts id from youtube.com/watch', () => {
    expect(extractVideoId('https://www.youtube.com/watch?v=abc12345678')).toBe('abc12345678')
  })

  it('ignores extra query params on youtube.com/watch', () => {
    expect(extractVideoId('https://www.youtube.com/watch?v=abc12345678&t=45s'))
      .toBe('abc12345678')
  })

  it('extracts id from youtube.com/shorts', () => {
    expect(extractVideoId('https://www.youtube.com/shorts/abc12345678')).toBe('abc12345678')
  })

  it('extracts id from youtube.com/live', () => {
    expect(extractVideoId('https://www.youtube.com/live/abc12345678')).toBe('abc12345678')
  })

  it('extracts id from m.youtube.com/watch', () => {
    expect(extractVideoId('https://m.youtube.com/watch?v=abc12345678')).toBe('abc12345678')
  })

  it('returns null for non-youtube URL', () => {
    expect(extractVideoId('https://example.com')).toBeNull()
  })

  it('returns null for non-URL string', () => {
    expect(extractVideoId('not a url')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(extractVideoId('')).toBeNull()
  })

  it('returns null when youtu.be path is wrong length', () => {
    expect(extractVideoId('https://youtu.be/short')).toBeNull()
  })

  it('returns null when watch query has no v param', () => {
    expect(extractVideoId('https://www.youtube.com/watch?t=3')).toBeNull()
  })
})

vi.mock('youtube-transcript-plus', () => ({
  YoutubeTranscript: {
    fetchTranscript: vi.fn(),
  },
}))

// 延後 import、在 vi.mock 註冊後拿 mocked 引用
const { YoutubeTranscript } = await import('youtube-transcript-plus')
const mockFetchTranscript = vi.mocked(YoutubeTranscript.fetchTranscript)

describe('fetchTranscript', () => {
  beforeEach(() => {
    mockFetchTranscript.mockReset()
  })

  it('joins transcript segments with newline', async () => {
    mockFetchTranscript.mockResolvedValue([
      { text: '第一段', duration: 1, offset: 0, lang: 'zh-TW' },
      { text: '第二段、含標點', duration: 1, offset: 2, lang: 'zh-TW' },
    ])
    const result = await fetchTranscript('abc12345678')
    expect(result.transcript).toBe('第一段\n第二段、含標點')
    expect(result.originalLength).toBe(result.transcript.length)
    expect(result.language).toBe('zh-TW')
  })

  it('throws YoutubeError no_transcript when package says Transcript is disabled', async () => {
    mockFetchTranscript.mockRejectedValue(new Error('Transcript is disabled on this video'))
    await expect(fetchTranscript('abc12345678'))
      .rejects
      .toMatchObject({ name: 'YoutubeError', reason: 'no_transcript' })
  })

  it('throws YoutubeError no_transcript when package says no transcript available', async () => {
    mockFetchTranscript.mockRejectedValue(new Error('No transcripts are available'))
    await expect(fetchTranscript('abc12345678'))
      .rejects
      .toMatchObject({ reason: 'no_transcript' })
  })

  it('throws YoutubeError not_found when package says Video unavailable', async () => {
    mockFetchTranscript.mockRejectedValue(new Error('Video unavailable'))
    await expect(fetchTranscript('abc12345678'))
      .rejects
      .toMatchObject({ reason: 'not_found' })
  })

  it('throws YoutubeError fetch_failed for other errors', async () => {
    mockFetchTranscript.mockRejectedValue(new Error('ECONNRESET'))
    await expect(fetchTranscript('abc12345678'))
      .rejects
      .toMatchObject({ reason: 'fetch_failed' })
  })

  it('youtubeError is instanceof Error and carries reason', async () => {
    mockFetchTranscript.mockRejectedValue(new Error('ECONNRESET'))
    try {
      await fetchTranscript('abc12345678')
      throw new Error('expected throw')
    }
    catch (err) {
      expect(err).toBeInstanceOf(YoutubeError)
      expect(err).toBeInstanceOf(Error)
      expect((err as YoutubeError).reason).toBe('fetch_failed')
    }
  })

  it('throws no_transcript when segments is empty array', async () => {
    mockFetchTranscript.mockResolvedValue([])
    await expect(fetchTranscript('abc12345678'))
      .rejects
      .toMatchObject({ reason: 'no_transcript' })
  })

  it('breaks language loop on not_found and only attempts once', async () => {
    mockFetchTranscript.mockRejectedValue(new Error('Video unavailable'))
    await expect(fetchTranscript('abc12345678'))
      .rejects
      .toMatchObject({ reason: 'not_found' })
    // 影片不存在時、不應再試 zh-CN / en、只呼叫套件一次
    expect(mockFetchTranscript).toHaveBeenCalledTimes(1)
  })

  it('still iterates 3 languages on no_transcript', async () => {
    mockFetchTranscript.mockRejectedValue(new Error('No transcripts are available'))
    await expect(fetchTranscript('abc12345678'))
      .rejects
      .toMatchObject({ reason: 'no_transcript' })
    // 無字幕類錯誤、仍然跑完三語系 fallback 才放棄
    expect(mockFetchTranscript).toHaveBeenCalledTimes(3)
  })
})
