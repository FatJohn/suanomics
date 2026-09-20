import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@suanomics/prompt-research', () => ({
  DEFAULT_SOURCES: [
    { kind: 'skill-markdown', slug: 'default-src', displayName: 'Default', pipeline: 'light', config: {} },
  ],
  dispatchSource: vi.fn(),
  mergeDigests: vi.fn(),
  runCompile: vi.fn(),
  pruneOldCandidates: vi.fn().mockResolvedValue({ kept: [], removed: [] }),
}))
vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  return {
    ...actual,
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
  }
})

describe('runPromptRefresh', () => {
  beforeEach(async () => {
    vi.resetAllMocks()
    const { pruneOldCandidates } = await import('@suanomics/prompt-research')
    vi.mocked(pruneOldCandidates).mockResolvedValue({ kept: [], removed: [] })
  })

  it('uses DEFAULT_SOURCES when payload.sources missing', async () => {
    const { dispatchSource } = await import('@suanomics/prompt-research')
    const { mergeDigests } = await import('@suanomics/prompt-research')
    const { runCompile } = await import('@suanomics/prompt-research')
    vi.mocked(dispatchSource).mockResolvedValue({
      sourceSlug: 'default-src',
      sourceKind: 'skill-markdown',
      generatedAt: '2026-01-01T00:00:00.000Z',
      rawSourceRef: { url: 'http://example.com' },
      analystFrames: [],
      vocabulary: [],
      compliance: { redFlags: [] },
    } as never)
    vi.mocked(mergeDigests).mockReturnValue({
      markdown: '# md',
      draft: { generatedAt: 'x', sources: [], frames: [], vocabulary: [], redFlags: [], rawSourceRefs: [] },
    } as never)
    vi.mocked(runCompile).mockResolvedValue({
      runId: 'mock-run',
      compiled: { shared: 's', decomposer: 'd', analyst: 'a', synthesizer: 'sy' },
      promptsDir: '/abs/packages/prompts/_candidates/mock-run',
    } as never)

    const { runPromptRefresh } = await import('./run-prompt-refresh.js')
    const result = await runPromptRefresh({})

    expect(dispatchSource).toHaveBeenCalledTimes(1)
    expect(dispatchSource).toHaveBeenCalledWith(expect.objectContaining({ slug: 'default-src' }), expect.any(String))
    expect(result.sourcesProcessed).toBe(1)
    expect(result.runId).toMatch(/\d{4}-\d{2}-\d{2}T/)
    expect(result.candidatesDir).toMatch(/packages\/prompts\/_candidates\//)
  })

  it('uses payload.sources when provided', async () => {
    const { dispatchSource } = await import('@suanomics/prompt-research')
    const { mergeDigests } = await import('@suanomics/prompt-research')
    const { runCompile } = await import('@suanomics/prompt-research')
    vi.mocked(dispatchSource).mockResolvedValue({
      sourceSlug: 'cs',
      sourceKind: 'skill-markdown',
      generatedAt: 'x',
      rawSourceRef: { url: '' },
      analystFrames: [],
      vocabulary: [],
      compliance: { redFlags: [] },
    } as never)
    vi.mocked(mergeDigests).mockReturnValue({
      markdown: '',
      draft: { generatedAt: 'x', sources: [], frames: [], vocabulary: [], redFlags: [], rawSourceRefs: [] },
    } as never)
    vi.mocked(runCompile).mockResolvedValue({ runId: 'r', compiled: { shared: 's', decomposer: 'd', analyst: 'a', synthesizer: 'sy' }, promptsDir: 'x' } as never)

    const customSource = { kind: 'skill-markdown' as const, slug: 'cs', displayName: 'CS', pipeline: 'light' as const, config: {} }
    const { runPromptRefresh } = await import('./run-prompt-refresh.js')
    const result = await runPromptRefresh({ sources: [customSource] })

    expect(dispatchSource).toHaveBeenCalledTimes(1)
    expect(dispatchSource).toHaveBeenCalledWith(expect.objectContaining({ slug: 'cs' }), expect.any(String))
    expect(result.sourcesProcessed).toBe(1)
  })

  it('writes draft JSON to outputs dir before compile', async () => {
    const { dispatchSource } = await import('@suanomics/prompt-research')
    const { mergeDigests } = await import('@suanomics/prompt-research')
    const { runCompile } = await import('@suanomics/prompt-research')
    const { writeFile } = await import('node:fs/promises')
    vi.mocked(dispatchSource).mockResolvedValue({
      sourceSlug: 'default-src',
      sourceKind: 'skill-markdown',
      generatedAt: 'x',
      rawSourceRef: { url: '' },
      analystFrames: [],
      vocabulary: [],
      compliance: { redFlags: [] },
    } as never)
    vi.mocked(mergeDigests).mockReturnValue({
      markdown: '',
      draft: { generatedAt: 'x', sources: [], frames: [], vocabulary: [], redFlags: [], rawSourceRefs: [] },
    } as never)
    vi.mocked(runCompile).mockResolvedValue({
      runId: 'r',
      compiled: { shared: 's', decomposer: 'd', analyst: 'a', synthesizer: 'sy' },
      promptsDir: 'x',
    } as never)

    const { runPromptRefresh } = await import('./run-prompt-refresh.js')
    await runPromptRefresh({})

    // writeFile 應該被叫過、第一個 arg path 含 'merged-analyzer-prompt-draft.json'
    expect(writeFile).toHaveBeenCalledWith(
      expect.stringMatching(/merged-analyzer-prompt-draft\.json$/),
      expect.any(String),
      'utf-8',
    )
  })
})
