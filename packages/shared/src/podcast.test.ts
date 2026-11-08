import type { Podcast } from './podcast.js'
import { describe, expect, it } from 'vitest'
import { makePodcastSchemaWithCitations, PodcastSchema } from './podcast.js'

const VALID_HOOK = {
  headline: '今天我們聊一個你可能還沒注意到的重要訊號',
  body: '我胖胖、回來陪你聊本日財經。'.repeat(11), // 14 chars × 11 = 154 chars (≥ 150)
}

const VALID_ACT = {
  actTitle: '輝達需求其實有個更微妙的訊號',
  storyline: 'ai-tech' as const,
  body: '本段內容描述輝達 AI 需求的細節傳導鏈。'.repeat(20), // ~400 chars
  citationUrls: ['https://example.com/a'],
  relatedNewsIds: ['n1'],
}

const VALID_TAKEAWAY = {
  body: '這是收尾段、回扣 hook 提的訊號。'.repeat(10), // ~190 chars
}

const VALID_META = {
  totalChars: 2000,
  persona: 'panpan' as const,
  generatedAt: '2026-04-30T01:00:00.000Z',
}

const VALID_PODCAST: Podcast = {
  briefDate: '2026-04-30',
  hook: VALID_HOOK,
  acts: [VALID_ACT, VALID_ACT, VALID_ACT],
  takeaway: VALID_TAKEAWAY,
  meta: VALID_META,
}

describe('podcastSchema — happy path', () => {
  it('accepts a valid podcast with 3 acts', () => {
    expect(() => PodcastSchema.parse(VALID_PODCAST)).not.toThrow()
  })
  it('accepts up to 5 acts', () => {
    expect(() =>
      PodcastSchema.parse({ ...VALID_PODCAST, acts: Array.from({ length: 5 }).fill(VALID_ACT) }),
    ).not.toThrow()
  })
})

describe('podcastSchema — boundaries', () => {
  it('rejects fewer than 3 acts', () => {
    expect(() =>
      PodcastSchema.parse({ ...VALID_PODCAST, acts: [VALID_ACT, VALID_ACT] }),
    ).toThrow()
  })
  it('rejects more than 5 acts', () => {
    expect(() =>
      PodcastSchema.parse({ ...VALID_PODCAST, acts: Array.from({ length: 6 }).fill(VALID_ACT) }),
    ).toThrow()
  })
  it('rejects briefDate not in YYYY-MM-DD format', () => {
    expect(() =>
      PodcastSchema.parse({ ...VALID_PODCAST, briefDate: '2026/04/30' }),
    ).toThrow()
  })
  it('rejects hook.headline shorter than 20 chars', () => {
    expect(() =>
      PodcastSchema.parse({
        ...VALID_PODCAST,
        hook: { ...VALID_HOOK, headline: '太短' },
      }),
    ).toThrow()
  })
  it('rejects hook.headline longer than 80 chars', () => {
    expect(() =>
      PodcastSchema.parse({
        ...VALID_PODCAST,
        hook: { ...VALID_HOOK, headline: '長'.repeat(81) },
      }),
    ).toThrow()
  })
  it('rejects act.body shorter than 300', () => {
    expect(() =>
      PodcastSchema.parse({
        ...VALID_PODCAST,
        acts: [{ ...VALID_ACT, body: '短' }, VALID_ACT, VALID_ACT],
      }),
    ).toThrow()
  })
  it('rejects act.storyline outside enum', () => {
    expect(() =>
      PodcastSchema.parse({
        ...VALID_PODCAST,
        acts: [{ ...VALID_ACT, storyline: 'crypto' as never }, VALID_ACT, VALID_ACT],
      }),
    ).toThrow()
  })
  it('rejects act.citationUrls empty', () => {
    expect(() =>
      PodcastSchema.parse({
        ...VALID_PODCAST,
        acts: [{ ...VALID_ACT, citationUrls: [] }, VALID_ACT, VALID_ACT],
      }),
    ).toThrow()
  })
  it('rejects act.relatedNewsIds empty', () => {
    expect(() =>
      PodcastSchema.parse({
        ...VALID_PODCAST,
        acts: [{ ...VALID_ACT, relatedNewsIds: [] }, VALID_ACT, VALID_ACT],
      }),
    ).toThrow()
  })
  it('rejects meta.totalChars below 1800', () => {
    expect(() =>
      PodcastSchema.parse({
        ...VALID_PODCAST,
        meta: { ...VALID_META, totalChars: 1799 },
      }),
    ).toThrow()
  })
  it('rejects meta.totalChars above 2800', () => {
    expect(() =>
      PodcastSchema.parse({
        ...VALID_PODCAST,
        meta: { ...VALID_META, totalChars: 2801 },
      }),
    ).toThrow()
  })
  it('rejects meta.persona that is not "panpan"', () => {
    expect(() =>
      PodcastSchema.parse({
        ...VALID_PODCAST,
        meta: { ...VALID_META, persona: 'other' as never },
      }),
    ).toThrow()
  })
  it('rejects act.body longer than 800 chars', () => {
    expect(() =>
      PodcastSchema.parse({
        ...VALID_PODCAST,
        acts: [{ ...VALID_ACT, body: 'x'.repeat(801) }, VALID_ACT, VALID_ACT],
      }),
    ).toThrow()
  })
  it('rejects takeaway.body longer than 400 chars', () => {
    expect(() =>
      PodcastSchema.parse({
        ...VALID_PODCAST,
        takeaway: { body: 'x'.repeat(401) },
      }),
    ).toThrow()
  })
})

describe('makePodcastSchemaWithCitations — citation subset hook', () => {
  it('accepts when all act.citationUrls are in allowed set', () => {
    const schema = makePodcastSchemaWithCitations(['https://example.com/a'])
    expect(() => schema.parse(VALID_PODCAST)).not.toThrow()
  })
  it('rejects when any act.citationUrl is not in allowed set', () => {
    const schema = makePodcastSchemaWithCitations(['https://other.com/x'])
    expect(() => schema.parse(VALID_PODCAST)).toThrow(/unknown citation url/i)
  })
  it('reports which URL is the offender in the error message', () => {
    const schema = makePodcastSchemaWithCitations(['https://other.com/x'])
    let err: Error | null = null
    try {
      schema.parse(VALID_PODCAST)
    }
    catch (e) {
      err = e as Error
    }
    expect(err?.message).toMatch(/example\.com\/a/)
  })
})
