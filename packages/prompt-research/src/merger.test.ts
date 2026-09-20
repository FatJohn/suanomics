import type { Digest } from './types.js'
import { describe, expect, it } from 'vitest'
import { mergeCompliance, mergeDigests, mergeFrames, mergeVocabulary, normalizeKey, renderMergedMarkdown } from './merger.js'
import { MergedDraftSchema } from './types.js'

function digest(slug: string, frames: Array<Partial<Digest['analystFrames'][number]>>): Digest {
  return {
    sourceSlug: slug,
    sourceKind: 'skill-markdown',
    generatedAt: '2026-04-22T00:00:00Z',
    analystFrames: frames.map((f, i) => ({
      id: f.id ?? `stub${i}000`,
      name: f.name ?? `frame-${i}`,
      description: f.description ?? 'd',
      whenToApply: f.whenToApply ?? 'w',
      questions: f.questions ?? ['q'],
    })),
    analysisChecks: [],
    vocabulary: [],
    rawSourceRef: {},
  }
}

describe('normalizeKey', () => {
  it('lowercases and strips punctuation / whitespace', () => {
    expect(normalizeKey('  When the Fed! acts. ')).toBe('when the fed acts')
  })
})

describe('mergeFrames', () => {
  it('groups frames by whenToApply (normalized equal)', () => {
    const a = digest('a', [{ whenToApply: '央行升息', name: 'f1' }])
    const b = digest('b', [{ whenToApply: '央行升息', name: 'f2' }])
    const result = mergeFrames([a, b])
    expect(result).toHaveLength(1)
    const first = result[0]
    if (!first)
      throw new Error('expected first group')
    expect(first.group).toBe('央行升息')
    expect(first.frames).toHaveLength(2)
    expect(first.frames.map(f => f.from)).toEqual(['a', 'b'])
  })

  it('keeps frames with distinct whenToApply separate', () => {
    const a = digest('a', [{ whenToApply: '央行升息' }])
    const b = digest('b', [{ whenToApply: '地緣政治緊張' }])
    const result = mergeFrames([a, b])
    expect(result).toHaveLength(2)
  })

  it('fuzzy-clusters similar whenToApply above threshold 0.7', () => {
    const a = digest('a', [{ whenToApply: '央行升息時' }])
    const b = digest('b', [{ whenToApply: '當央行升息' }])
    const result = mergeFrames([a, b])
    expect(result).toHaveLength(1)
  })

  it('does not cluster dissimilar strings below threshold', () => {
    const a = digest('a', [{ whenToApply: '央行升息' }])
    const b = digest('b', [{ whenToApply: '台股財報季' }])
    const result = mergeFrames([a, b])
    expect(result).toHaveLength(2)
  })

  it('clusters near-identical English variations', () => {
    const a = digest('a', [{ whenToApply: 'when the fed raises rates' }])
    const b = digest('b', [{ whenToApply: 'when the fed raises rate' }])
    const result = mergeFrames([a, b])
    expect(result).toHaveLength(1)
  })

  it('keeps unrelated single-character keys distinct', () => {
    const a = digest('a', [{ whenToApply: 'x' }])
    const b = digest('b', [{ whenToApply: 'y' }])
    const result = mergeFrames([a, b])
    expect(result).toHaveLength(2)
  })
})

describe('mergeVocabulary', () => {
  it('unions avoid lists and concatenates reasons', () => {
    const a = digest('a', [{ whenToApply: 'x' }])
    a.vocabulary = [
      { id: 'aaaa0001', preferred: '配置比重提升', avoid: ['增持'], reason: 'KOL 原話' },
    ]
    const b = digest('b', [{ whenToApply: 'x' }])
    b.vocabulary = [
      { id: 'bbbb0002', preferred: '配置比重提升', avoid: ['加碼'], reason: '投信投顧法' },
    ]
    const merged = mergeVocabulary([a, b])
    expect(merged).toHaveLength(1)
    const first = merged[0]
    if (!first)
      throw new Error('expected first vocab entry')
    expect(first.avoid.sort()).toEqual(['加碼', '增持'])
    expect(first.reason).toContain('KOL')
    expect(first.reason).toContain('投信')
  })
})

describe('mergeCompliance', () => {
  it('unions redFlags and collects disclaimers', () => {
    const a = digest('a', [{ whenToApply: 'x' }])
    a.compliance = { redFlags: [{ id: 'cccc0001', rule: 'r1' }], suggestedDisclaimer: 'd1' }
    const b = digest('b', [{ whenToApply: 'x' }])
    b.compliance = { redFlags: [{ id: 'dddd0002', rule: 'r2' }] }
    const merged = mergeCompliance([a, b])
    expect(merged.redFlags.sort()).toEqual(['r1', 'r2'])
    expect(merged.disclaimers).toEqual(['d1'])
  })
})

describe('renderMergedMarkdown', () => {
  it('contains Part A/B/C/D/E section headers', () => {
    const d = digest('a', [{ whenToApply: '央行升息' }])
    const md = renderMergedMarkdown([d], '2026-04-22T00:00:00Z')
    expect(md).toMatch(/Part A: Analyst Frames/)
    expect(md).toMatch(/Part B: Vocabulary/)
    expect(md).toMatch(/Part C: Compliance/)
    expect(md).toMatch(/Part D: Suggested Analyzer System Prompt/)
    expect(md).toMatch(/Part E: Raw Source Refs/)
  })

  it('lists each source slug in Part E', () => {
    const a = digest('a', [{ whenToApply: 'x' }])
    a.rawSourceRef = { url: 'https://a.example/SKILL.md' }
    const md = renderMergedMarkdown([a], '2026-04-22T00:00:00Z')
    expect(md).toContain('a: https://a.example/SKILL.md')
  })

  it('part D stub 指向 production prompt 路徑、不指已廢路徑', () => {
    const d = digest('a', [{ whenToApply: '央行升息' }])
    const md = renderMergedMarkdown([d], '2026-04-22T00:00:00Z')
    // production prompt 集中在 apps/server/src/prompts/
    expect(md).toContain('apps/server/src/prompts/')
    expect(md).not.toContain('apps/server/src/agents/')
    // 舊路徑不應再出現
    expect(md).not.toContain('apps/api/src/lib/brief/prompts.ts')
  })
})

describe('mergeDigests JSON output', () => {
  it('should return MergedDraft alongside markdown', () => {
    const a = digest('source-a', [{ whenToApply: 'x' }])
    a.vocabulary = [{ id: 'aaaa0001', preferred: 'p', avoid: ['av'], reason: 'r' }]
    const b = digest('source-b', [{ whenToApply: 'y' }])
    const result = mergeDigests([a, b])
    expect(typeof result.markdown).toBe('string')
    expect(MergedDraftSchema.safeParse(result.draft).success).toBe(true)
    expect(result.draft.frames.length).toBeGreaterThanOrEqual(1)
    expect(result.draft.vocabulary.some(v => v.sourceSlug === 'source-a')).toBe(true)
  })

  it('should preserve sourceSlug per item', () => {
    const a = digest('source-a', [{ whenToApply: 'p' }])
    const b = digest('source-b', [{ whenToApply: 'q' }])
    const { draft } = mergeDigests([a, b])
    const slugs = draft.frames.flatMap(g => g.items).map(i => i.sourceSlug)
    expect(slugs).toContain('source-a')
    expect(slugs).toContain('source-b')
  })
})
