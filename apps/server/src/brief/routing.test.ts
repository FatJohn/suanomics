import type { CachedAnalysis } from '@suanomics/db/repos/analyses-repo'
import { describe, expect, it, vi } from 'vitest'
import { buildAliasMap } from '../agents/entity-aliases.js'
import { decideRouting } from './routing.js'

const aliasMap = buildAliasMap([
  { canonical: 'fed', aliases: ['Fed', 'FOMC', '聯準會'] },
  { canonical: 'rate-cut', aliases: ['降息', 'rate cut'] },
  { canonical: 'tsmc', aliases: ['TSMC', '台積電'] },
])

const sampleCached: CachedAnalysis = {
  id: 1,
  payload: {} as unknown as CachedAnalysis['payload'],
  entities: ['fed', 'rate-cut'],
  expiresAt: null,
}

describe('decideRouting', () => {
  it('returns cache-hit when inputHash matches and not expired', async () => {
    const findCachedByInputHash = vi.fn().mockResolvedValue(sampleCached)
    const findCachedByEntityOverlap = vi.fn()
    const r = await decideRouting(
      { url: 'https://x.com/a', title: 'T1', content: 'C1' },
      { aliasMap, findCachedByInputHash, findCachedByEntityOverlap },
    )
    expect(r.mode).toBe('cache-hit')
    if (r.mode === 'cache-hit')
      expect(r.cached).toBe(sampleCached)
    expect(findCachedByEntityOverlap).not.toHaveBeenCalled()
  })

  it('falls to full-pipeline when no cache and < 2 canonical entities', async () => {
    const r = await decideRouting(
      { title: 'random text 沒 entity', content: '雜訊雜訊雜訊雜訊雜訊雜訊雜訊雜訊雜訊雜訊雜訊' },
      {
        aliasMap,
        findCachedByInputHash: vi.fn().mockResolvedValue(null),
        findCachedByEntityOverlap: vi.fn(),
      },
    )
    expect(r.mode).toBe('full-pipeline')
  })

  it('returns db-related when ≥1 candidate passes 60% threshold', async () => {
    const candidate: CachedAnalysis = { id: 2, payload: {} as unknown as CachedAnalysis['payload'], entities: ['fed', 'rate-cut'], expiresAt: null }
    const r = await decideRouting(
      { title: 'Fed 降息', content: '聯準會宣布降息一碼、影響台股深遠'.repeat(2) },
      {
        aliasMap,
        findCachedByInputHash: vi.fn().mockResolvedValue(null),
        findCachedByEntityOverlap: vi.fn().mockResolvedValue([candidate]),
      },
    )
    expect(r.mode).toBe('db-related')
    if (r.mode === 'db-related') {
      expect(r.cachedNeighbors).toContain(candidate)
      expect(r.inputCanonical.sort()).toEqual(['fed', 'rate-cut'].sort())
    }
  })

  it('uses min denominator for 60% (input ⊂ cached counts as 100%)', async () => {
    const candidate: CachedAnalysis = {
      id: 2,
      payload: {} as unknown as CachedAnalysis['payload'],
      entities: ['fed', 'rate-cut', 'tsmc', 'oil-price', 'inflation'],
      expiresAt: null,
    }
    const r = await decideRouting(
      { title: 'Fed 降息', content: '聯準會降息消息'.repeat(3) },
      {
        aliasMap,
        findCachedByInputHash: vi.fn().mockResolvedValue(null),
        findCachedByEntityOverlap: vi.fn().mockResolvedValue([candidate]),
      },
    )
    // input={fed,rate-cut} (size 2), cached size 5, intersect=2
    // min(2,5)=2, ratio=100% → db-related
    expect(r.mode).toBe('db-related')
  })

  it('returns gap-scrape when entity ≥ 2 but no candidate passes 60%', async () => {
    const candidate: CachedAnalysis = {
      id: 2,
      payload: {} as unknown as CachedAnalysis['payload'],
      entities: ['oil-price'],
      expiresAt: null,
    }
    const r = await decideRouting(
      { title: 'Fed 降息', content: '聯準會降息'.repeat(3) },
      {
        aliasMap,
        findCachedByInputHash: vi.fn().mockResolvedValue(null),
        findCachedByEntityOverlap: vi.fn().mockResolvedValue([candidate]),
      },
    )
    expect(r.mode).toBe('gap-scrape')
    if (r.mode === 'gap-scrape') {
      expect(r.inputCanonical.sort()).toEqual(['fed', 'rate-cut'].sort())
      expect(r.existingDbArticles).toHaveLength(1)
    }
  })

  it('returns gap-scrape when entity ≥ 2 and DB returns empty', async () => {
    const r = await decideRouting(
      { title: 'Fed 降息', content: '聯準會降息消息'.repeat(3) },
      {
        aliasMap,
        findCachedByInputHash: vi.fn().mockResolvedValue(null),
        findCachedByEntityOverlap: vi.fn().mockResolvedValue([]),
      },
    )
    expect(r.mode).toBe('gap-scrape')
  })
})
