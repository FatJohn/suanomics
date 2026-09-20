import type { ParsedEntry } from '../external/rss-fetcher.js'

export function filterNewEntries(entries: readonly ParsedEntry[], existingIds: ReadonlySet<string>): ParsedEntry[] {
  return entries.filter(e => !existingIds.has(e.externalId))
}
