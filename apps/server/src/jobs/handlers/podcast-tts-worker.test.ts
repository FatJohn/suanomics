import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as podcastTts from '../../podcast/tts.js'
import { processPodcastTtsJob } from './podcast-tts-worker.js'

vi.mock('../../podcast/tts.js')

describe('processPodcastTtsJob', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('calls runPodcastTts and returns the result', async () => {
    vi.mocked(podcastTts.runPodcastTts).mockResolvedValue({
      briefDate: '2026-05-17',
      storedPath: 'podcast/2026-05-17.mp3',
      bytes: 12345,
      scriptChars: 800,
      ttsLatencyMs: 7000,
      skipped: false,
      voice: 'Algieba',
      segmentCount: 2,
      segments: [],
    })
    const updateProgress = vi.fn()
    const r = await processPodcastTtsJob({
      payload: { date: '2026-05-17' },
      updateProgress,
    })
    expect(r.storedPath).toBe('podcast/2026-05-17.mp3')
    expect(updateProgress).toHaveBeenCalledWith(100)
  })

  it('propagates runPodcastTts errors so worker can mark failed', async () => {
    vi.mocked(podcastTts.runPodcastTts).mockRejectedValue(new Error('gemini 429'))
    await expect(processPodcastTtsJob({
      payload: { date: '2026-05-17' },
    })).rejects.toThrow(/gemini 429/)
  })
})
