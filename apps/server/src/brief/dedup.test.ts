import type { ParsedEntry } from '../external/rss-fetcher.js'
import { describe, expect, it } from 'vitest'
import { dedupByExternalId } from '../external/rss-fetcher.js'
import { filterNewEntries } from './dedup.js'

describe('dedupByExternalId', () => {
  it('shouldRemoveDuplicatesByExternalIdWithinBatch', () => {
    const entries: ParsedEntry[] = [
      { externalId: 'a', title: 'A', url: 'http://x/a', publishedAt: null, excerpt: '' },
      { externalId: 'b', title: 'B', url: 'http://x/b', publishedAt: null, excerpt: '' },
      { externalId: 'a', title: 'A dup', url: 'http://x/a2', publishedAt: null, excerpt: '' },
    ]
    expect(dedupByExternalId(entries).map(e => e.externalId)).toEqual(['a', 'b'])
  })

  it('shouldPreserveFirstOccurrence', () => {
    const entries: ParsedEntry[] = [
      { externalId: 'a', title: 'first', url: 'http://x/1', publishedAt: null, excerpt: '' },
      { externalId: 'a', title: 'second', url: 'http://x/2', publishedAt: null, excerpt: '' },
    ]
    expect(dedupByExternalId(entries)[0]?.title).toBe('first')
  })
})

describe('filterNewEntries', () => {
  it('shouldKeepOnlyEntriesWithExternalIdNotInExisting', () => {
    const fresh: ParsedEntry[] = [
      { externalId: 'new-1', title: 'X', url: 'http://x/1', publishedAt: null, excerpt: '' },
      { externalId: 'old-1', title: 'Y', url: 'http://x/2', publishedAt: null, excerpt: '' },
    ]
    const existingIds = new Set(['old-1', 'old-2'])
    expect(filterNewEntries(fresh, existingIds).map(e => e.externalId)).toEqual(['new-1'])
  })

  it('shouldReturnEmptyWhenAllExist', () => {
    const fresh: ParsedEntry[] = [
      { externalId: 'a', title: 'X', url: 'http://x/1', publishedAt: null, excerpt: '' },
    ]
    expect(filterNewEntries(fresh, new Set(['a']))).toHaveLength(0)
  })
})
