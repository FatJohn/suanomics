import { Buffer } from 'node:buffer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runPodcastTts } from './tts.js'

vi.mock('@suanomics/db/client')
vi.mock('@suanomics/db/schema')
vi.mock('@suanomics/db/storage/podcast-storage')
vi.mock('../podcast-tts/pcm-concat.js')
vi.mock('../podcast-tts/mp3-encode.js')
vi.mock('../podcast-tts/segment-timecodes.js')
vi.mock('../podcast-tts/script-builder.js')
vi.mock('../podcast-tts/gemini-tts-client.js')
vi.mock('../podcast-tts/azure-tts-client.js')

// PodcastSchema 有嚴格字數限制：headline≥20、body≥150、act.body≥300、takeaway≥150、totalChars≥1800、acts.min(3)
function makeValidPodcast(): unknown {
  const longHookBody = 'hook body text '.repeat(12).trimEnd()
  const longActBody = 'act body text for this section '.repeat(11).trimEnd()
  const longTakeawayBody = 'takeaway body text '.repeat(9).trimEnd()
  return {
    briefDate: '2026-05-17',
    hook: { headline: 'This is a valid headline for hook', body: longHookBody },
    acts: [
      { actTitle: 'Act One Title Here', storyline: 'ai-tech', body: longActBody, citationUrls: ['https://x.com/a'], relatedNewsIds: ['n1'] },
      { actTitle: 'Act Two Title Here', storyline: 'rates', body: longActBody, citationUrls: ['https://x.com/b'], relatedNewsIds: ['n2'] },
      { actTitle: 'Act Three Title OK', storyline: 'consumer', body: longActBody, citationUrls: ['https://x.com/c'], relatedNewsIds: ['n3'] },
    ],
    takeaway: { body: longTakeawayBody },
    meta: { totalChars: 1900, persona: 'panpan', generatedAt: '2026-05-17T00:00:00Z' },
  }
}

describe('runPodcastTts', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('throws when no daily_brief row exists for date', async () => {
    const { getDb } = await import('@suanomics/db/client')
    const select = vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(() => Promise.resolve([])) })) })) }))
    vi.mocked(getDb).mockReturnValue({ select } as never)
    await expect(runPodcastTts({ date: '2026-05-17' }))
      .rejects
      .toThrow(/no daily_brief row/i)
  })

  it('throws on invalid date format', async () => {
    await expect(runPodcastTts({ date: 'tomorrow' })).rejects.toThrow(/invalid date format/i)
    await expect(runPodcastTts({ date: '2026-5-17' })).rejects.toThrow(/invalid date format/i)
  })

  it('gemini provider：逐段 synthesize（N 段=N 次）、concat→mp3、存檔並更新 DB', async () => {
    vi.stubEnv('PODCAST_TTS_PROVIDER', 'gemini')
    const row = { briefDate: '2026-05-17', podcastJson: makeValidPodcast(), podcastAudioPath: null }

    const { getDb } = await import('@suanomics/db/client')
    const updateWhere = vi.fn(() => Promise.resolve())
    const update = vi.fn(() => ({ set: vi.fn(() => ({ where: updateWhere })) }))
    const select = vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(() => Promise.resolve([row])) })) })) }))
    vi.mocked(getDb).mockReturnValue({ select, update } as never)

    const { getPodcastStorage } = await import('@suanomics/db/storage/podcast-storage')
    const save = vi.fn(() => Promise.resolve('podcast/2026-05-17.mp3'))
    vi.mocked(getPodcastStorage).mockReturnValue({ save } as never)

    const { segmentPodcastScript } = await import('../podcast-tts/script-builder.js')
    vi.mocked(segmentPodcastScript).mockReturnValue([
      { text: 'seg1', section: 'hook', sectionIndex: 0 },
      { text: 'seg2', section: 'act', sectionIndex: 0 },
    ])
    const { synthesize } = await import('../podcast-tts/gemini-tts-client.js')
    vi.mocked(synthesize).mockResolvedValue({ pcm: Buffer.from([0, 0]), sampleRate: 24000 })
    const { concatPcmSegments } = await import('../podcast-tts/pcm-concat.js')
    vi.mocked(concatPcmSegments).mockReturnValue(Buffer.from([0, 0, 0, 0]))
    const { encodeMp3 } = await import('../podcast-tts/mp3-encode.js')
    const fakeMp3 = Buffer.from([0xFF, 0xFB, 0x00])
    vi.mocked(encodeMp3).mockReturnValue(fakeMp3)
    const { computeSegmentTimecodes } = await import('../podcast-tts/segment-timecodes.js')
    vi.mocked(computeSegmentTimecodes).mockReturnValue([
      { startMs: 0, durationMs: 100 },
      { startMs: 250, durationMs: 200 },
    ])

    const result = await runPodcastTts({ date: '2026-05-17' })

    expect(vi.mocked(synthesize)).toHaveBeenCalledTimes(2)
    expect(save).toHaveBeenCalledWith('2026-05-17', fakeMp3)
    expect(update).toHaveBeenCalled()
    expect(result.segmentCount).toBe(2)
    expect(result.segments).toEqual([
      { section: 'hook', sectionIndex: 0, startMs: 0, durationMs: 100 },
      { section: 'act', sectionIndex: 0, startMs: 250, durationMs: 200 },
    ])
    expect(result.skipped).toBe(false)
    expect(result.provider).toBe('gemini')
  })

  it('azure provider：整集一次 synthesizeAzure、存檔並更新 DB、不切段', async () => {
    vi.stubEnv('PODCAST_TTS_PROVIDER', 'azure')
    const row = { briefDate: '2026-05-17', podcastJson: makeValidPodcast(), podcastAudioPath: null }

    const { getDb } = await import('@suanomics/db/client')
    const updateWhere = vi.fn(() => Promise.resolve())
    const update = vi.fn(() => ({ set: vi.fn(() => ({ where: updateWhere })) }))
    const select = vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(() => Promise.resolve([row])) })) })) }))
    vi.mocked(getDb).mockReturnValue({ select, update } as never)

    const { getPodcastStorage } = await import('@suanomics/db/storage/podcast-storage')
    const save = vi.fn(() => Promise.resolve('podcast/2026-05-17.mp3'))
    vi.mocked(getPodcastStorage).mockReturnValue({ save } as never)

    const { buildFullScript } = await import('../podcast-tts/script-builder.js')
    vi.mocked(buildFullScript).mockReturnValue('全文稿')
    const { synthesizeAzure } = await import('../podcast-tts/azure-tts-client.js')
    const fakeMp3 = Buffer.from([0xFF, 0xFB, 0x11])
    vi.mocked(synthesizeAzure).mockResolvedValue(fakeMp3)
    const { synthesize } = await import('../podcast-tts/gemini-tts-client.js')

    const result = await runPodcastTts({ date: '2026-05-17' })

    expect(vi.mocked(synthesizeAzure)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(synthesize)).not.toHaveBeenCalled() // azure 不走 gemini 切段
    expect(save).toHaveBeenCalledWith('2026-05-17', fakeMp3)
    expect(update).toHaveBeenCalled()
    expect(result.provider).toBe('azure')
    expect(result.segmentCount).toBe(0)
    expect(result.skipped).toBe(false)
  })

  it('未知 provider → fallback gemini（report provider=gemini）', async () => {
    vi.stubEnv('PODCAST_TTS_PROVIDER', 'bogus')
    const row = { briefDate: '2026-05-17', podcastJson: makeValidPodcast(), podcastAudioPath: null }

    const { getDb } = await import('@suanomics/db/client')
    const update = vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) })) }))
    const select = vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(() => Promise.resolve([row])) })) })) }))
    vi.mocked(getDb).mockReturnValue({ select, update } as never)
    const { getPodcastStorage } = await import('@suanomics/db/storage/podcast-storage')
    vi.mocked(getPodcastStorage).mockReturnValue({ save: vi.fn(() => Promise.resolve('podcast/2026-05-17.mp3')) } as never)
    const { segmentPodcastScript } = await import('../podcast-tts/script-builder.js')
    vi.mocked(segmentPodcastScript).mockReturnValue([{ text: 'seg1', section: 'hook', sectionIndex: 0 }])
    const { synthesize } = await import('../podcast-tts/gemini-tts-client.js')
    vi.mocked(synthesize).mockResolvedValue({ pcm: Buffer.from([0, 0]), sampleRate: 24000 })
    const { concatPcmSegments } = await import('../podcast-tts/pcm-concat.js')
    vi.mocked(concatPcmSegments).mockReturnValue(Buffer.from([0, 0]))
    const { encodeMp3 } = await import('../podcast-tts/mp3-encode.js')
    vi.mocked(encodeMp3).mockReturnValue(Buffer.from([0xFF, 0xFB]))
    const { computeSegmentTimecodes } = await import('../podcast-tts/segment-timecodes.js')
    vi.mocked(computeSegmentTimecodes).mockReturnValue([{ startMs: 0, durationMs: 50 }])
    const { synthesizeAzure } = await import('../podcast-tts/azure-tts-client.js')

    const result = await runPodcastTts({ date: '2026-05-17' })

    expect(vi.mocked(synthesize)).toHaveBeenCalled() // 走 gemini 切段路徑
    expect(vi.mocked(synthesizeAzure)).not.toHaveBeenCalled()
    expect(result.provider).toBe('gemini')
  })
})
