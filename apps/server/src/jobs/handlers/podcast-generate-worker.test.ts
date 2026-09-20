import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as podcastGen from '../../podcast/generate.js'
import { processPodcastGenerateJob } from './podcast-generate-worker.js'

vi.mock('../../podcast/generate.js')

const sampleResult = {
  briefDate: '2026-05-17',
  totalChars: 2000,
  acts: 3,
  forbiddenSanitized: 0,
  hookHeadline: 'h',
  elapsedMs: 15_000,
  skipped: false,
}

describe('processPodcastGenerateJob', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('calls runPodcastGenerate + chains podcast-tts on success', async () => {
    vi.mocked(podcastGen.runPodcastGenerate).mockResolvedValue(sampleResult)
    const enqueue = vi.fn(async () => ({ auditId: 'a', status: 'queued' as const }))
    const result = await processPodcastGenerateJob({
      payload: { date: '2026-05-17', force: false },
      enqueue: enqueue as never,
    })
    expect(result.totalChars).toBe(2000)
    expect(result.skipped).toBe(false)
    expect(enqueue).toHaveBeenCalledTimes(1)
    expect(enqueue).toHaveBeenCalledWith('podcast-tts', { date: '2026-05-17' })
  })

  it('chain enqueue failure does NOT fail the parent job', async () => {
    vi.mocked(podcastGen.runPodcastGenerate).mockResolvedValue(sampleResult)
    const enqueue = vi.fn(async () => {
      throw new Error('db down')
    })
    const result = await processPodcastGenerateJob({
      payload: { date: '2026-05-17', force: false },
      enqueue: enqueue as never,
    })
    expect(result.totalChars).toBe(2000)
  })

  it('propagates runPodcastGenerate errors so worker can mark failed', async () => {
    vi.mocked(podcastGen.runPodcastGenerate).mockRejectedValue(new Error('LLM 500'))
    const enqueue = vi.fn()
    await expect(processPodcastGenerateJob({
      payload: { date: '2026-05-17', force: false },
      enqueue: enqueue as never,
    })).rejects.toThrow(/LLM 500/)
    expect(enqueue).not.toHaveBeenCalled() // failure path 不 chain
  })

  it('does not chain podcast-tts when generate returns skipped', async () => {
    const skippedResult = {
      briefDate: '2026-05-17',
      totalChars: 1500,
      acts: 2,
      forbiddenSanitized: 0,
      hookHeadline: 'Market Update',
      elapsedMs: 0,
      skipped: true,
    }
    vi.mocked(podcastGen.runPodcastGenerate).mockResolvedValue(skippedResult)
    const enqueue = vi.fn(async () => ({ auditId: 'a', status: 'queued' as const }))
    const result = await processPodcastGenerateJob({
      payload: { date: '2026-05-17', force: false },
      enqueue: enqueue as never,
    })
    expect(result.skipped).toBe(true)
    expect(enqueue).not.toHaveBeenCalled()
  })
})
