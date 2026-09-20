import type { RunStats } from './logger.js'
import type { EpisodeL3 } from './schemas.js'
import { describe, expect, it } from 'vitest'
import { buildRunSummaryMarkdown } from './run-summary.js'

const FAKE_STATS: RunStats = {
  totalTokensIn: 100_000,
  totalTokensOut: 20_000,
  totalCostUsd: 0.05,
  retryCount: 1,
  eventCount: 50,
}

const FAKE_EPISODES: EpisodeL3[] = [{
  episodeId: 'ep1',
  title: 'Ep1',
  url: 'https://x.test/1',
  publishedAt: '2026-04-21T00:00:00Z',
  durationSec: 3600,
  segmenter: {
    episodeId: 'ep1',
    durationSec: 3600,
    segments: [{ startSec: 0, endSec: 60, topic: 'market', headline: 'h', relevance: 0.9 }],
    keptTopics: ['market'],
    droppedMinutes: { joke: 20, ad: 5, chitchat: 5, other: 0 },
  },
  events: [],
  citedSources: [],
  entities: [],
  reasoningChains: [],
  impacts: [],
  analystFrames: [],
}]

describe('buildRunSummaryMarkdown', () => {
  it('shouldIncludeRunIdAndStatsSection', () => {
    const md = buildRunSummaryMarkdown({
      runId: '2026-04-22-0830',
      episodes: FAKE_EPISODES,
      stats: FAKE_STATS,
      supplementChars: 10_500,
    })
    expect(md).toContain('2026-04-22-0830')
    expect(md).toContain('100,000')
    expect(md).toContain('$0.05')
  })

  it('shouldListEachEpisodeWithSegmenterBreakdown', () => {
    const md = buildRunSummaryMarkdown({
      runId: 'r',
      episodes: FAKE_EPISODES,
      stats: FAKE_STATS,
      supplementChars: 10_000,
    })
    expect(md).toContain('ep1')
    expect(md).toContain('20')
  })

  it('shouldIncludeSupplementCharsInHeader', () => {
    const md = buildRunSummaryMarkdown({
      runId: 'r',
      episodes: FAKE_EPISODES,
      stats: FAKE_STATS,
      supplementChars: 10_500,
    })
    expect(md).toContain('10,500')
  })

  it('shouldHaveExpectedSectionHeaders', () => {
    const md = buildRunSummaryMarkdown({
      runId: 'r',
      episodes: FAKE_EPISODES,
      stats: FAKE_STATS,
      supplementChars: 10_000,
    })
    expect(md).toContain('# YT Ingest Run')
    expect(md).toContain('## Stats')
    expect(md).toContain('## Episodes')
    expect(md).toContain('## Supplement')
  })
})
