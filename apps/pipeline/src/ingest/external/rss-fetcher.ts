import { createHash } from 'node:crypto'
import { XMLParser } from 'fast-xml-parser'

export interface ParsedEntry {
  externalId: string
  title: string
  url: string
  publishedAt: Date | null
  excerpt: string
}

interface RawItem {
  title?: unknown
  link?: unknown
  guid?: unknown
  pubDate?: unknown
  description?: unknown
}

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', parseTagValue: false })

function hashUrl(url: string): string {
  return createHash('sha1').update(url).digest('hex').slice(0, 16)
}

function extractGuid(item: RawItem): string | null {
  const g = item.guid
  if (typeof g === 'string')
    return g
  if (typeof g === 'number')
    return String(g)
  if (g && typeof g === 'object' && '#text' in g) {
    const inner = (g as { '#text'?: unknown })['#text']
    if (typeof inner === 'string')
      return inner
    if (typeof inner === 'number')
      return String(inner)
  }
  return null
}

function asString(v: unknown): string {
  if (typeof v === 'string')
    return v
  if (typeof v === 'number')
    return String(v)
  return ''
}

export function parseRssXml(xml: string): ParsedEntry[] {
  let raw: unknown
  try {
    raw = parser.parse(xml)
  }
  catch {
    return []
  }
  const channel = (raw as { rss?: { channel?: { item?: RawItem | RawItem[] } } })?.rss?.channel
  if (!channel)
    return []
  const items = Array.isArray(channel.item) ? channel.item : channel.item ? [channel.item] : []
  return items
    .filter((it): it is RawItem => typeof it === 'object' && it !== null)
    .map((it) => {
      const url = asString(it.link).trim()
      const guid = extractGuid(it)
      const externalId = guid ?? (url ? hashUrl(url) : '')
      const pubStr = asString(it.pubDate)
      const pub = pubStr ? new Date(pubStr) : null
      return {
        externalId,
        title: asString(it.title).trim(),
        url,
        publishedAt: pub && !Number.isNaN(pub.getTime()) ? pub : null,
        excerpt: asString(it.description).trim(),
      }
    })
    .filter(e => e.externalId && e.url && e.title)
}

export function dedupByExternalId(entries: readonly ParsedEntry[]): ParsedEntry[] {
  const seen = new Set<string>()
  const out: ParsedEntry[] = []
  for (const e of entries) {
    if (seen.has(e.externalId))
      continue
    seen.add(e.externalId)
    out.push(e)
  }
  return out
}

export async function fetchRss(url: string, timeoutMs = 10_000): Promise<string> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: ctl.signal })
    if (!res.ok)
      throw new Error(`RSS ${url} HTTP ${res.status}`)
    return await res.text()
  }
  finally { clearTimeout(timer) }
}
