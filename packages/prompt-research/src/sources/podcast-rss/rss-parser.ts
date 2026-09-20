import type { ParsedRss, PodcastChannel, PodcastEpisode } from './schemas.js'
import { createHash } from 'node:crypto'
import { XMLParser } from 'fast-xml-parser'

interface RawItem {
  'title'?: string
  'guid'?: string | { '#text'?: string }
  'pubDate'?: string
  'link'?: string
  'description'?: string
  'itunes:summary'?: string
  'content:encoded'?: string
  'itunes:duration'?: string | number
  'enclosure'?: { '@_url'?: string, '@_type'?: string, '@_length'?: string }
}

interface RawChannel {
  'title'?: string
  'description'?: string
  'itunes:author'?: string
  'item'?: RawItem | RawItem[]
}

interface RawRss {
  rss?: { channel?: RawChannel }
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
}

function parseDuration(input: string | number | undefined): number {
  if (input === undefined || input === null)
    return 0
  if (typeof input === 'number' && Number.isFinite(input))
    return Math.max(0, Math.floor(input))
  const s = String(input).trim()
  if (/^\d+$/.test(s))
    return Number.parseInt(s, 10)
  const parts = s.split(':').map(p => Number.parseInt(p, 10))
  if (parts.some(n => !Number.isFinite(n)))
    return 0
  if (parts.length === 3) {
    const [h, m, sec] = parts as [number, number, number]
    return h * 3600 + m * 60 + sec
  }
  if (parts.length === 2) {
    const [m, sec] = parts as [number, number]
    return m * 60 + sec
  }
  return 0
}

function rfc822ToIso(input: string | undefined): string {
  if (!input)
    return new Date(0).toISOString()
  const d = new Date(input)
  if (Number.isNaN(d.getTime()))
    return new Date(0).toISOString()
  return d.toISOString()
}

function extractGuid(g: RawItem['guid']): string | undefined {
  if (typeof g === 'string')
    return g
  if (g && typeof g === 'object' && typeof g['#text'] === 'string')
    return g['#text']
  return undefined
}

function extractDescription(item: RawItem): string | undefined {
  const raw = item['itunes:summary'] ?? item.description ?? item['content:encoded']
  if (typeof raw !== 'string')
    return undefined
  const stripped = stripHtml(raw)
  return stripped.length > 0 ? stripped : undefined
}

function hashId(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 16)
}

function buildEpisode(item: RawItem): PodcastEpisode | null {
  const url = item.enclosure?.['@_url']
  if (!url) {
    console.warn(`[podcast-rss] skipping item without enclosure: ${item.title ?? '<no-title>'}`)
    return null
  }
  const guid = extractGuid(item.guid)
  return {
    episodeId: guid ?? hashId(url),
    title: item.title ?? '<untitled>',
    publishedAt: rfc822ToIso(item.pubDate),
    enclosureUrl: url,
    enclosureType: item.enclosure?.['@_type'] ?? 'audio/mpeg',
    durationSec: parseDuration(item['itunes:duration']),
    description: extractDescription(item),
    pageUrl: item.link,
  }
}

export function parseRssXml(xml: string): ParsedRss {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    trimValues: true,
  })
  const raw = parser.parse(xml) as RawRss
  const ch = raw.rss?.channel ?? {}
  const items = Array.isArray(ch.item) ? ch.item : ch.item ? [ch.item] : []
  const episodes = items
    .map(buildEpisode)
    .filter((e): e is PodcastEpisode => e !== null)
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))

  const channel: PodcastChannel = {
    title: ch.title ?? '<untitled channel>',
    author: ch['itunes:author'],
    description: ch.description,
  }

  return { channel, episodes }
}
