import type { VideoRef } from './playlist-resolver.js'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  applySelectionFlags,
  parseStreamsHtml,

} from './playlist-resolver.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixtureHtml = readFileSync(
  join(__dirname, '__fixtures__/yt-streams-sample.html'),
  'utf8',
)
const lockupFixtureHtml = readFileSync(
  join(__dirname, '__fixtures__/streams-lockup-2026.html'),
  'utf8',
)

describe('parseStreamsHtml', () => {
  it('shouldExtractVideoListFromYouTubeStreamsPage', () => {
    const videos = parseStreamsHtml(fixtureHtml)
    expect(videos.length).toBeGreaterThan(0)
    expect(videos[0]).toMatchObject({
      videoId: expect.any(String),
      title: expect.any(String),
      url: expect.stringMatching(/^https:\/\/www\.youtube\.com\/watch\?v=/),
    })
  })

  it('shouldParseLockupViewModelStreamsPage', () => {
    // YouTube 改用 lockupViewModel 取代 videoRenderer（2026 中）
    const videos = parseStreamsHtml(lockupFixtureHtml)
    expect(videos.length).toBeGreaterThanOrEqual(2)

    const [first] = videos
    if (!first)
      throw new Error('expected at least one parsed video')
    expect(first).toMatchObject({
      videoId: 'lockupVid01',
      url: 'https://www.youtube.com/watch?v=lockupVid01',
    })
    // title 含日期樣式可供 matcher 用
    expect(first.title).toMatch(/2026\/\d{1,2}\/\d{1,2}/)
    expect(first.durationSec).toBe(32 * 60 + 29)
    // publishedAt 形狀正確（ISO 8601）
    expect(first.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(Number.isNaN(Date.parse(first.publishedAt))).toBe(false)
  })

  it('shouldReturnEmptyArrayForInvalidHtml', () => {
    expect(parseStreamsHtml('<html>no yt data here</html>')).toEqual([])
  })
})

describe('applySelectionFlags', () => {
  const videos: VideoRef[] = Array.from({ length: 10 }, (_, i) => ({
    videoId: `vid${i}`,
    title: `Ep ${i}`,
    url: `https://www.youtube.com/watch?v=vid${i}`,
    publishedAt: new Date(
      `2026-04-${String(22 - i).padStart(2, '0')}T00:00:00Z`,
    ).toISOString(),
    durationSec: 3600,
  }))

  it('shouldReturnLatest7WhenNoFlagsGiven', () => {
    expect(applySelectionFlags(videos, {}).length).toBe(7)
  })

  it('shouldRespectCountFlag', () => {
    expect(applySelectionFlags(videos, { count: 3 }).length).toBe(3)
  })

  it('shouldReturnAllWhenCountAll', () => {
    expect(applySelectionFlags(videos, { count: 'all' }).length).toBe(10)
  })

  it('shouldRespectRangeFlag', () => {
    const out = applySelectionFlags(videos, { range: [2, 4] })
    expect(out.length).toBe(3)
    expect(out.map(v => v.videoId)).toEqual(['vid2', 'vid3', 'vid4'])
  })

  it('shouldFilterByVideoIdsWhenGiven', () => {
    const out = applySelectionFlags(videos, { videoIds: ['vid3', 'vid7'] })
    expect(out.length).toBe(2)
    expect(out.map(v => v.videoId).sort()).toEqual(['vid3', 'vid7'])
  })

  it('shouldPreserveOrderNewestToOldest', () => {
    const out = applySelectionFlags(videos, { count: 5 })
    for (let i = 1; i < out.length; i++) {
      // eslint-disable-next-line ts/no-non-null-assertion -- i and i-1 are within bounds (loop guards i < out.length)
      expect(out[i - 1]!.publishedAt >= out[i]!.publishedAt).toBe(true)
    }
  })
})
