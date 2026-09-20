import { describe, expect, it } from 'vitest'
import {
  AnalyzePayloadSchema,
  CorpusRefreshPayloadSchema,
  DailyBriefPayloadSchema,
  JOB_KINDS,
  MarketDataRefreshPayloadSchema,
  NewsRefreshPayloadSchema,
  PodcastGeneratePayloadSchema,
  PodcastTtsPayloadSchema,
  PromptRefreshPayloadSchema,
  SourceSpecSchema,
} from './types.js'

// eslint-disable-next-line test/prefer-lowercase-title -- JOB_KINDS is an all-caps constant name; lowercasing would misrepresent the symbol under test
describe('JOB_KINDS', () => {
  it('contains the core job kinds in order', () => {
    expect(JOB_KINDS).toContain('corpus-refresh')
    expect(JOB_KINDS).toContain('analyze')
    expect(JOB_KINDS).toContain('daily-brief')
    expect(JOB_KINDS).toContain('podcast-generate')
    expect(JOB_KINDS).toContain('podcast-tts')
    expect(JOB_KINDS).toContain('news-refresh')
  })
})

describe('corpusRefreshPayloadSchema', () => {
  it('accepts empty', () => {
    expect(CorpusRefreshPayloadSchema.parse({})).toEqual({ force: false })
  })
  it('accepts sourceSlugs + force', () => {
    expect(CorpusRefreshPayloadSchema.parse({ sourceSlugs: ['anue'], force: true }))
      .toEqual({ sourceSlugs: ['anue'], force: true })
  })
  it('rejects non-array sourceSlugs', () => {
    expect(() => CorpusRefreshPayloadSchema.parse({ sourceSlugs: 'anue' })).toThrow()
  })
})

describe('analyzePayloadSchema', () => {
  const validPayload = {
    title: 'Fed 升息決議',
    content: '美國聯準會宣布升息一碼，市場反應平淡，科技股小跌。',
    reportDate: '2026-08-06',
  }

  it('accepts title + content without url', () => {
    expect(AnalyzePayloadSchema.parse(validPayload)).toEqual(validPayload)
  })
  it('accepts title + content + url', () => {
    const withUrl = { ...validPayload, url: 'https://a.com/x' }
    expect(AnalyzePayloadSchema.parse(withUrl)).toEqual(withUrl)
  })
  it('rejects missing title', () => {
    expect(() => AnalyzePayloadSchema.parse({ content: validPayload.content })).toThrow()
  })
  it('rejects missing content', () => {
    expect(() => AnalyzePayloadSchema.parse({ title: validPayload.title })).toThrow()
  })
  it('rejects empty object', () => {
    expect(() => AnalyzePayloadSchema.parse({})).toThrow()
  })
  it('rejects title shorter than 3 chars', () => {
    expect(() => AnalyzePayloadSchema.parse({ ...validPayload, title: 'ab' })).toThrow()
  })
  it('rejects content shorter than 20 chars', () => {
    expect(() => AnalyzePayloadSchema.parse({ ...validPayload, content: '太短' })).toThrow()
  })
  it('trims whitespace from title and content', () => {
    const parsed = AnalyzePayloadSchema.parse({
      title: '  Fed 升息  ',
      content: '  美國聯準會宣布升息一碼，市場反應平淡，科技股小跌。  ',
      reportDate: '2026-08-06',
    })
    expect(parsed.title).toBe('Fed 升息')
    expect(parsed.content).toBe('美國聯準會宣布升息一碼，市場反應平淡，科技股小跌。')
  })

  // analyze 有兩個生產者：`POST /api/brief/analyze` 與每日 brief 的預跑
  // （brief-worker 的 fire-and-forget，catch 只 console.warn）。reportDate 若可省略，
  // 任一方漏傳都會安靜地讓 EvidenceClaim 的 asOf 綁到執行時刻而非該分析所屬的日子。
  it('rejects payload without reportDate', () => {
    const { reportDate: _omitted, ...withoutDate } = validPayload
    expect(() => AnalyzePayloadSchema.parse(withoutDate)).toThrow()
  })

  it('rejects a non-ISO reportDate', () => {
    expect(() => AnalyzePayloadSchema.parse({ ...validPayload, reportDate: '2026/08/06' })).toThrow()
  })
})

describe('dailyBriefPayloadSchema', () => {
  it('accepts ISO date', () => {
    expect(DailyBriefPayloadSchema.parse({ date: '2026-04-23' })).toEqual({ date: '2026-04-23', chainPodcast: true })
  })
  it('rejects non-ISO date', () => {
    expect(() => DailyBriefPayloadSchema.parse({ date: '4/23/2026' })).toThrow()
  })
})

// eslint-disable-next-line test/prefer-lowercase-title -- JOB_KINDS is an all-caps constant name; lowercasing would misrepresent the symbol under test
describe('JOB_KINDS — extended for P2', () => {
  it('contains podcast-generate / podcast-tts / news-refresh', () => {
    expect(JOB_KINDS).toContain('podcast-generate')
    expect(JOB_KINDS).toContain('podcast-tts')
    expect(JOB_KINDS).toContain('news-refresh')
  })
})

describe('podcastGeneratePayloadSchema', () => {
  it('accepts ISO date alone (force defaults false)', () => {
    expect(PodcastGeneratePayloadSchema.parse({ date: '2026-05-17' }))
      .toEqual({ date: '2026-05-17', force: false })
  })
  it('accepts force=true', () => {
    expect(PodcastGeneratePayloadSchema.parse({ date: '2026-05-17', force: true }))
      .toEqual({ date: '2026-05-17', force: true })
  })
  it('rejects non-ISO date', () => {
    expect(() => PodcastGeneratePayloadSchema.parse({ date: '5/17/2026' })).toThrow()
  })
  it('rejects missing date', () => {
    expect(() => PodcastGeneratePayloadSchema.parse({})).toThrow()
  })
})

describe('podcastTtsPayloadSchema', () => {
  it('accepts ISO date', () => {
    expect(PodcastTtsPayloadSchema.parse({ date: '2026-05-17' })).toEqual({ date: '2026-05-17' })
  })
  it('rejects non-ISO date', () => {
    expect(() => PodcastTtsPayloadSchema.parse({ date: 'tomorrow' })).toThrow()
  })
})

describe('newsRefreshPayloadSchema', () => {
  it('rejects empty object — bucket 必填、呼叫端不得省略', () => {
    expect(() => NewsRefreshPayloadSchema.parse({})).toThrow()
  })
  it('strips unknown fields (zod default)', () => {
    expect(NewsRefreshPayloadSchema.parse({ bucket: '2026-05-18T14', extra: 'ignored' }))
      .toEqual({ bucket: '2026-05-18T14' })
  })
  it('accepts bucket string', () => {
    expect(NewsRefreshPayloadSchema.parse({ bucket: '2026-05-18T14' }))
      .toEqual({ bucket: '2026-05-18T14' })
  })
  it('rejects non-string bucket', () => {
    expect(() => NewsRefreshPayloadSchema.parse({ bucket: 123 })).toThrow()
  })
})

describe('dailyBriefPayloadSchema — chainPodcast', () => {
  it('defaults chainPodcast to true when omitted', () => {
    expect(DailyBriefPayloadSchema.parse({ date: '2026-05-17' }))
      .toEqual({ date: '2026-05-17', chainPodcast: true })
  })
  it('accepts chainPodcast=false', () => {
    expect(DailyBriefPayloadSchema.parse({ date: '2026-05-17', chainPodcast: false }))
      .toEqual({ date: '2026-05-17', chainPodcast: false })
  })
  it('accepts chainPodcast=true explicit', () => {
    expect(DailyBriefPayloadSchema.parse({ date: '2026-05-17', chainPodcast: true }))
      .toEqual({ date: '2026-05-17', chainPodcast: true })
  })
})

// eslint-disable-next-line test/prefer-lowercase-title -- JOB_KINDS is an all-caps constant name; lowercasing would misrepresent the symbol under test
describe('JOB_KINDS includes prompt-refresh', () => {
  it('appends prompt-refresh at the end', () => {
    expect(JOB_KINDS).toEqual([
      'corpus-refresh',
      'analyze',
      'daily-brief',
      'podcast-generate',
      'podcast-tts',
      'news-refresh',
      'prompt-refresh',
      'market-data-refresh',
    ])
  })
})

// eslint-disable-next-line test/prefer-lowercase-title -- JOB_KINDS is an all-caps constant name; lowercasing would misrepresent the symbol under test
describe('JOB_KINDS includes market-data-refresh', () => {
  it('contains market-data-refresh', () => {
    expect(JOB_KINDS).toContain('market-data-refresh')
  })
})

describe('marketDataRefreshPayloadSchema', () => {
  it('rejects empty object — bucket 必填、呼叫端不得省略', () => {
    expect(() => MarketDataRefreshPayloadSchema.parse({})).toThrow()
  })
  it('accepts bucket string', () => {
    expect(MarketDataRefreshPayloadSchema.parse({ bucket: '2026-06-12' }))
      .toEqual({ bucket: '2026-06-12' })
  })
  it('rejects non-string bucket', () => {
    expect(() => MarketDataRefreshPayloadSchema.parse({ bucket: 123 })).toThrow()
  })
})

describe('sourceSpecSchema', () => {
  const valid = {
    kind: 'yt-transcript' as const,
    slug: 'yt-test',
    displayName: 'YT Test',
    config: { channelId: 'UC...', count: 3 },
  }
  it('accepts valid spec + default pipeline', () => {
    expect(SourceSpecSchema.parse(valid)).toEqual({ ...valid, pipeline: 'light' })
  })
  it('accepts skill-markdown kind', () => {
    expect(SourceSpecSchema.parse({ ...valid, kind: 'skill-markdown' }).kind).toBe('skill-markdown')
  })
  it('accepts deep pipeline override', () => {
    expect(SourceSpecSchema.parse({ ...valid, pipeline: 'deep' }).pipeline).toBe('deep')
  })
  it('rejects unknown kind', () => {
    expect(() => SourceSpecSchema.parse({ ...valid, kind: 'rss' })).toThrow()
  })
  it('rejects empty slug', () => {
    expect(() => SourceSpecSchema.parse({ ...valid, slug: '' })).toThrow()
  })
  it('rejects missing config', () => {
    const { config, ...withoutConfig } = valid
    expect(() => SourceSpecSchema.parse(withoutConfig)).toThrow()
  })
})

describe('promptRefreshPayloadSchema', () => {
  it('rejects empty object — bucket 必填、呼叫端不得省略', () => {
    expect(() => PromptRefreshPayloadSchema.parse({})).toThrow()
  })
  it('accepts bucket only', () => {
    expect(PromptRefreshPayloadSchema.parse({ bucket: '2026-05-18' })).toEqual({ bucket: '2026-05-18' })
  })
  it('accepts sources list', () => {
    const sources = [{
      kind: 'yt-transcript' as const,
      slug: 'x',
      displayName: 'X',
      config: {},
    }]
    const parsed = PromptRefreshPayloadSchema.parse({ sources, bucket: '2026-05-18' })
    expect(parsed.sources).toHaveLength(1)
    expect(parsed.sources?.[0]?.pipeline).toBe('light')
  })
  it('rejects sources with bad kind', () => {
    expect(() => PromptRefreshPayloadSchema.parse({
      sources: [{ kind: 'rss', slug: 'x', displayName: 'X', config: {} }],
    })).toThrow()
  })
})
