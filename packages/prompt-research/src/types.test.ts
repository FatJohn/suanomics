import { describe, expect, it } from 'vitest'
import { CustomSourceConfigSchema, DigestSchema, MergedDraftSchema, PodcastRssConfigSchema, SkillSourceConfigSchema, SourceKindSchema, SourceSpecSchema, YtSourceConfigSchema } from './types.js'

describe('digestSchema', () => {
  it('accepts minimal valid digest with required fields', () => {
    const input = {
      sourceSlug: 'skill-foo',
      sourceKind: 'skill-markdown',
      generatedAt: '2026-04-22T10:00:00Z',
      analystFrames: [{
        id: 'a1b2c3d4',
        name: '5-phase scoping',
        description: 'Walks through 5 phases of scoping.',
        whenToApply: '新聞提到央行政策改變時',
        questions: ['Q1', 'Q2', 'Q3'],
      }],
      rawSourceRef: { url: 'https://example.com' },
    }
    const parsed = DigestSchema.parse(input)
    expect(parsed.analysisChecks).toEqual([])
    expect(parsed.vocabulary).toEqual([])
  })

  it('rejects digest with zero analystFrames (min 1)', () => {
    const input = {
      sourceSlug: 'skill-foo',
      sourceKind: 'skill-markdown',
      generatedAt: '2026-04-22T10:00:00Z',
      analystFrames: [],
      rawSourceRef: { url: 'https://example.com' },
    }
    expect(() => DigestSchema.parse(input)).toThrow()
  })

  it('rejects digest with invalid generatedAt (not ISO)', () => {
    const input = {
      sourceSlug: 'x',
      sourceKind: 'skill-markdown',
      generatedAt: 'not-iso',
      analystFrames: [{ id: 'a1b2c3d4', name: 'n', description: 'd', whenToApply: 'w', questions: ['q'] }],
      rawSourceRef: { url: 'https://x.com' },
    }
    expect(() => DigestSchema.parse(input)).toThrow()
  })

  it('accepts full digest including analysisChecks / vocabulary / compliance', () => {
    const input = {
      sourceSlug: 'yt-kol',
      sourceKind: 'yt-transcript',
      generatedAt: '2026-04-22T10:00:00Z',
      analystFrames: [{ id: 'a1b2c3d4', name: 'n', description: 'd', whenToApply: 'w', questions: ['q'] }],
      analysisChecks: [{ name: 'ratio-check', purpose: 'sanity', inputsNeeded: ['P/E'] }],
      vocabulary: [{ id: 'e5f6a7b8', preferred: '配置比重提升', avoid: ['增持'], reason: '投信投顧法' }],
      compliance: { redFlags: [{ id: 'c9d0e1f2', rule: 'no tickers' }], suggestedDisclaimer: 'not advice' },
      rawSourceRef: { url: 'https://example.com', commitSha: 'abc123' },
    }
    const parsed = DigestSchema.parse(input)
    expect(parsed.analysisChecks).toHaveLength(1)
    expect(parsed.vocabulary).toHaveLength(1)
    expect(parsed.compliance?.redFlags[0]?.rule).toBe('no tickers')
  })

  it('rejects digest with malformed rawSourceRef.url', () => {
    const input = {
      sourceSlug: 'x',
      sourceKind: 'skill-markdown',
      generatedAt: '2026-04-22T10:00:00Z',
      analystFrames: [{ id: 'a1b2c3d4', name: 'n', description: 'd', whenToApply: 'w', questions: ['q'] }],
      rawSourceRef: { url: 'not-a-url' },
    }
    expect(() => DigestSchema.parse(input)).toThrow()
  })

  it('accepts null rawSourceRef.url / localPath / commitSha (normalizes to undefined)', () => {
    const input = {
      sourceSlug: 'x',
      sourceKind: 'skill-markdown',
      generatedAt: '2026-04-22T10:00:00Z',
      analystFrames: [{ id: 'a1b2c3d4', name: 'n', description: 'd', whenToApply: 'w', questions: ['q'] }],
      rawSourceRef: { url: null, localPath: null, commitSha: null },
    }
    const parsed = DigestSchema.parse(input)
    expect(parsed.rawSourceRef.url).toBeUndefined()
    expect(parsed.rawSourceRef.localPath).toBeUndefined()
    expect(parsed.rawSourceRef.commitSha).toBeUndefined()
  })

  it('accepts null compliance.suggestedDisclaimer (normalizes to undefined)', () => {
    const input = {
      sourceSlug: 'x',
      sourceKind: 'skill-markdown',
      generatedAt: '2026-04-22T10:00:00Z',
      analystFrames: [{ id: 'a1b2c3d4', name: 'n', description: 'd', whenToApply: 'w', questions: ['q'] }],
      compliance: { redFlags: [], suggestedDisclaimer: null },
      rawSourceRef: { url: 'https://x.com' },
    }
    const parsed = DigestSchema.parse(input)
    expect(parsed.compliance?.suggestedDisclaimer).toBeUndefined()
  })
})

describe('sourceKindSchema', () => {
  it.each(['yt-transcript', 'skill-markdown', 'custom-text', 'podcast-rss'])('accepts %s', (kind) => {
    expect(SourceKindSchema.parse(kind)).toBe(kind)
  })

  it('rejects unknown kind', () => {
    expect(() => SourceKindSchema.parse('pdf')).toThrow()
  })
})

describe('podcastRssConfigSchema', () => {
  it('accepts valid rssUrl + count', () => {
    const cfg = PodcastRssConfigSchema.parse({
      rssUrl: 'https://example.com/feed.xml',
      count: 5,
    })
    expect(cfg.rssUrl).toBe('https://example.com/feed.xml')
    expect(cfg.count).toBe(5)
  })

  it('applies default count = 5', () => {
    const cfg = PodcastRssConfigSchema.parse({ rssUrl: 'https://example.com/feed.xml' })
    expect(cfg.count).toBe(5)
  })

  it('rejects non-URL rssUrl', () => {
    expect(() => PodcastRssConfigSchema.parse({ rssUrl: 'not-a-url' })).toThrow()
  })

  it('rejects negative count', () => {
    expect(() => PodcastRssConfigSchema.parse({
      rssUrl: 'https://example.com/feed.xml',
      count: -1,
    })).toThrow()
  })
})

describe('sourceSpecSchema', () => {
  it('accepts a skill-markdown spec', () => {
    const spec = {
      kind: 'skill-markdown',
      slug: 'skill-x',
      displayName: 'X',
      pipeline: 'light',
      config: { repoOwner: 'a', repoName: 'b', skillPath: 'c/d.md' },
    }
    expect(SourceSpecSchema.parse(spec).slug).toBe('skill-x')
  })

  it('rejects spec with empty slug', () => {
    const spec = { kind: 'skill-markdown', slug: '', displayName: 'X', pipeline: 'light', config: {} }
    expect(() => SourceSpecSchema.parse(spec)).toThrow()
  })
})

describe('ytSourceConfigSchema', () => {
  it('defaults count to 5 when omitted', () => {
    const parsed = YtSourceConfigSchema.parse({ playlistUrl: 'https://youtube.com/a' })
    expect(parsed.count).toBe(5)
  })

  it('rejects non-URL playlistUrl', () => {
    expect(() => YtSourceConfigSchema.parse({ playlistUrl: 'not-a-url' })).toThrow()
  })
})

describe('skillSourceConfigSchema', () => {
  it('defaults ref to main', () => {
    const parsed = SkillSourceConfigSchema.parse({ repoOwner: 'a', repoName: 'b', skillPath: 'c.md' })
    expect(parsed.ref).toBe('main')
  })
})

describe('customSourceConfigSchema', () => {
  it('requires filePath', () => {
    expect(() => CustomSourceConfigSchema.parse({})).toThrow()
  })
})

describe('mergedDraftSchema', () => {
  it('should accept valid merged draft', () => {
    const valid = {
      generatedAt: '2026-04-25T00:00:00Z',
      sources: [{ slug: 's1', kind: 'skill-markdown', displayName: 'S1', pipeline: 'light', config: {} }],
      frames: [{
        groupKey: '央行政策改變時',
        items: [{ id: 'abcd1234', sourceSlug: 's1', frame: { id: 'abcd1234', name: 'f', description: 'd', whenToApply: 'w', questions: ['q'] } }],
      }],
      vocabulary: [{ id: 'beef0001', sourceSlug: 's1', entry: { id: 'beef0001', preferred: 'p', avoid: ['a'], reason: 'r' } }],
      redFlags: [{ id: 'face0001', sourceSlug: 's1', entry: { id: 'face0001', rule: 'r' } }],
      rawSourceRefs: [{ sourceSlug: 's1', ref: { url: 'http://example.com' } }],
    }
    expect(MergedDraftSchema.safeParse(valid).success).toBe(true)
  })

  it('should reject when frames items missing id', () => {
    const invalid = {
      generatedAt: '2026-04-25T00:00:00Z',
      sources: [],
      frames: [{ groupKey: 'k', items: [{ sourceSlug: 's', frame: { name: 'f' } }] }], // missing id
      vocabulary: [],
      redFlags: [],
      rawSourceRefs: [],
    }
    expect(MergedDraftSchema.safeParse(invalid).success).toBe(false)
  })
})

describe('digestSchema (id fields)', () => {
  const baseFrame = {
    name: 'foo',
    description: 'd',
    whenToApply: 'w',
    questions: ['q1'],
  }

  it('should require id on each frame', () => {
    const result = DigestSchema.safeParse({
      sourceSlug: 's',
      sourceKind: 'skill-markdown',
      generatedAt: '2026-04-25T00:00:00Z',
      analystFrames: [baseFrame], // missing id
      vocabulary: [],
      rawSourceRef: {},
    })
    expect(result.success).toBe(false)
  })

  it('should accept frame with id', () => {
    const result = DigestSchema.safeParse({
      sourceSlug: 's',
      sourceKind: 'skill-markdown',
      generatedAt: '2026-04-25T00:00:00Z',
      analystFrames: [{ id: 'abcd1234', ...baseFrame }],
      vocabulary: [],
      rawSourceRef: {},
    })
    expect(result.success).toBe(true)
  })

  it('should require id on each vocab entry', () => {
    const result = DigestSchema.safeParse({
      sourceSlug: 's',
      sourceKind: 'skill-markdown',
      generatedAt: '2026-04-25T00:00:00Z',
      analystFrames: [{ id: 'abcd1234', ...baseFrame }],
      vocabulary: [{ preferred: 'p', avoid: ['a'], reason: 'r' }], // missing id
      rawSourceRef: {},
    })
    expect(result.success).toBe(false)
  })

  it('should require id on each redFlag', () => {
    const result = DigestSchema.safeParse({
      sourceSlug: 's',
      sourceKind: 'skill-markdown',
      generatedAt: '2026-04-25T00:00:00Z',
      analystFrames: [{ id: 'abcd1234', ...baseFrame }],
      vocabulary: [],
      compliance: { redFlags: [{ rule: 'x' }] }, // missing id
      rawSourceRef: {},
    })
    expect(result.success).toBe(false)
  })
})
