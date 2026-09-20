import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../prompt-research/run-prompt-refresh.js', () => ({
  runPromptRefresh: vi.fn(),
}))

describe('processPromptRefreshJob', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('calls runPromptRefresh with payload and reports progress', async () => {
    const { runPromptRefresh } = await import('../../prompt-research/run-prompt-refresh.js')
    vi.mocked(runPromptRefresh).mockResolvedValue({
      runId: 'r1',
      sourcesProcessed: 3,
      candidatesDir: 'packages/prompts/_candidates/r1',
      candidatesWritten: ['a.system.ts'],
      candidatesPruned: [],
    })
    const updateProgress = vi.fn()

    const { processPromptRefreshJob } = await import('./prompt-refresh-worker.js')
    const result = await processPromptRefreshJob({ payload: {}, updateProgress })

    expect(runPromptRefresh).toHaveBeenCalledWith({})
    expect(updateProgress).toHaveBeenCalledWith(10)
    expect(updateProgress).toHaveBeenCalledWith(100)
    expect(result.runId).toBe('r1')
    expect(result.sourcesProcessed).toBe(3)
  })

  it('propagates runPromptRefresh errors so worker can mark audit failed', async () => {
    const { runPromptRefresh } = await import('../../prompt-research/run-prompt-refresh.js')
    vi.mocked(runPromptRefresh).mockRejectedValue(new Error('gemini 503'))
    const { processPromptRefreshJob } = await import('./prompt-refresh-worker.js')
    await expect(processPromptRefreshJob({ payload: {} })).rejects.toThrow(/gemini 503/)
  })

  it('forwards payload.sources to runPromptRefresh', async () => {
    const { runPromptRefresh } = await import('../../prompt-research/run-prompt-refresh.js')
    vi.mocked(runPromptRefresh).mockResolvedValue({ runId: 'r', sourcesProcessed: 1, candidatesDir: '', candidatesWritten: [], candidatesPruned: [] })

    const customSource = { kind: 'yt-transcript' as const, slug: 'cs', displayName: 'CS', pipeline: 'light' as const, config: {} }
    const { processPromptRefreshJob } = await import('./prompt-refresh-worker.js')
    await processPromptRefreshJob({ payload: { sources: [customSource] }, updateProgress: vi.fn() })

    expect(runPromptRefresh).toHaveBeenCalledWith({ sources: [customSource] })
  })
})
