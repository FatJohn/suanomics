import type { PodcastEpisode } from './schemas.js'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseRssXml } from './rss-parser.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

function loadFixture(name: string): string {
  return readFileSync(resolve(__dirname, '__fixtures__', name), 'utf8')
}

function findEp(episodes: PodcastEpisode[], id: string): PodcastEpisode {
  const ep = episodes.find(e => e.episodeId === id)
  if (!ep)
    throw new Error(`episode not found: ${id}`)
  return ep
}

function firstEp(episodes: PodcastEpisode[]): PodcastEpisode {
  const ep = episodes[0]
  if (!ep)
    throw new Error('no episodes')
  return ep
}

describe('parseRssXml', () => {
  it('parses channel meta (title + author + description)', () => {
    const result = parseRssXml(loadFixture('sample-podcast.xml'))
    expect(result.channel.title).toBe('範例財經 Podcast')
    expect(result.channel.author).toBe('範例主持人')
    expect(result.channel.description).toBe('財經 podcast 範例')
  })

  it('returns episodes sorted by publishedAt desc', () => {
    const result = parseRssXml(loadFixture('sample-podcast.xml'))
    expect(result.episodes.map(e => e.episodeId)).toEqual(['ep-003', 'ep-002', 'ep-001'])
  })

  it('extracts enclosure url + type', () => {
    const result = parseRssXml(loadFixture('sample-podcast.xml'))
    const ep3 = firstEp(result.episodes)
    expect(ep3.enclosureUrl).toBe('https://example.com/ep-003.mp3')
    expect(ep3.enclosureType).toBe('audio/mpeg')
  })

  it('parses itunes:duration HH:MM:SS format', () => {
    const result = parseRssXml(loadFixture('sample-podcast.xml'))
    const ep3 = findEp(result.episodes, 'ep-003')
    expect(ep3.durationSec).toBe(1 * 3600 + 23 * 60 + 45) // 5025
  })

  it('parses itunes:duration MM:SS format', () => {
    const result = parseRssXml(loadFixture('sample-podcast.xml'))
    const ep1 = findEp(result.episodes, 'ep-001')
    expect(ep1.durationSec).toBe(45 * 60 + 30) // 2730
  })

  it('parses itunes:duration plain seconds', () => {
    const result = parseRssXml(loadFixture('sample-podcast.xml'))
    const ep2 = findEp(result.episodes, 'ep-002')
    expect(ep2.durationSec).toBe(3600)
  })

  it('prefers itunes:summary over description for description field', () => {
    const result = parseRssXml(loadFixture('sample-podcast.xml'))
    const ep3 = findEp(result.episodes, 'ep-003')
    expect(ep3.description).toBe('第三集摘要')
  })

  it('falls back to description when itunes:summary absent', () => {
    const result = parseRssXml(loadFixture('sample-podcast.xml'))
    const ep1 = findEp(result.episodes, 'ep-001')
    expect(ep1.description).toContain('第一集摘要')
  })

  it('strips HTML tags from description', () => {
    const result = parseRssXml(loadFixture('sample-podcast.xml'))
    const ep1 = findEp(result.episodes, 'ep-001')
    expect(ep1.description).not.toContain('<p>')
  })

  it('falls back to content:encoded when no description or summary', () => {
    const result = parseRssXml(loadFixture('sample-podcast.xml'))
    const ep2 = findEp(result.episodes, 'ep-002')
    expect(ep2.description).toContain('content encoded')
  })

  it('skips items without enclosure (warning OK)', () => {
    const result = parseRssXml(loadFixture('sample-no-itunes.xml'))
    expect(result.episodes).toHaveLength(1)
    expect(firstEp(result.episodes).title).toBe('good ep')
  })

  it('handles plain RSS without itunes namespace', () => {
    const result = parseRssXml(loadFixture('sample-no-itunes.xml'))
    expect(result.channel.title).toBe('Plain Feed')
    expect(firstEp(result.episodes).description).toBe('plain desc')
  })

  it('falls back episodeId to hash when guid missing', () => {
    const result = parseRssXml(loadFixture('sample-no-itunes.xml'))
    expect(firstEp(result.episodes).episodeId).toMatch(/^[a-f0-9]{8,}$/)
  })
})
