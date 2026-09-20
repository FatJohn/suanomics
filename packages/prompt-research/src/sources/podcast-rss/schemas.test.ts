import { describe, expect, it } from 'vitest'
import { PodcastChannelSchema, PodcastEpisodeSchema } from './schemas.js'

describe('podcastEpisodeSchema', () => {
  it('accepts canonical episode with required fields', () => {
    const ep = PodcastEpisodeSchema.parse({
      episodeId: 'ep-001',
      title: '本週解析',
      publishedAt: '2026-05-21T08:00:00.000Z',
      enclosureUrl: 'https://example.com/ep-001.mp3',
      enclosureType: 'audio/mpeg',
      durationSec: 3600,
    })
    expect(ep.episodeId).toBe('ep-001')
  })

  it('allows optional description + pageUrl', () => {
    const ep = PodcastEpisodeSchema.parse({
      episodeId: 'ep',
      title: 't',
      publishedAt: '2026-05-21T00:00:00.000Z',
      enclosureUrl: 'https://example.com/e.mp3',
      enclosureType: 'audio/mpeg',
      durationSec: 0,
      description: '本集摘要',
      pageUrl: 'https://example.com/episode/1',
    })
    expect(ep.description).toBe('本集摘要')
  })

  it('rejects missing enclosureUrl', () => {
    expect(() => PodcastEpisodeSchema.parse({
      episodeId: 'ep',
      title: 't',
      publishedAt: '2026-05-21T00:00:00.000Z',
      enclosureType: 'audio/mpeg',
      durationSec: 0,
    })).toThrow()
  })
})

describe('podcastChannelSchema', () => {
  it('accepts canonical channel', () => {
    const ch = PodcastChannelSchema.parse({
      title: '範例財經 Podcast',
      author: '範例主持人',
      description: '財經分析 podcast',
    })
    expect(ch.title).toBe('範例財經 Podcast')
  })

  it('allows minimal channel (title only)', () => {
    const ch = PodcastChannelSchema.parse({ title: 'X' })
    expect(ch.title).toBe('X')
  })
})
