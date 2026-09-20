import { describe, expect, it } from 'vitest'
import {
  AnalystFrameSchema,
  CitedSourceSchema,
  EntitySchema,
  EventSchema,
  ImpactSchema,
  ReasoningChainSchema,
  SegmenterOutputSchema,
  SegmentSchema,
} from './schemas.js'

describe('segmentSchema', () => {
  it('shouldAcceptValidSegment', () => {
    expect(() => SegmentSchema.parse({
      startSec: 0,
      endSec: 60,
      topic: 'market',
      headline: '盤前',
      relevance: 0.9,
    })).not.toThrow()
  })

  it('shouldRejectNegativeStartSec', () => {
    expect(() => SegmentSchema.parse({
      startSec: -1,
      endSec: 60,
      topic: 'market',
      headline: 'x',
      relevance: 0.5,
    })).toThrow()
  })

  it('shouldRejectInvalidTopic', () => {
    expect(() => SegmentSchema.parse({
      startSec: 0,
      endSec: 60,
      topic: 'unknown',
      headline: 'x',
      relevance: 0.5,
    })).toThrow()
  })

  it('shouldRejectRelevanceOutOfRange', () => {
    expect(() => SegmentSchema.parse({
      startSec: 0,
      endSec: 60,
      topic: 'market',
      headline: 'x',
      relevance: 1.5,
    })).toThrow()
  })
})

describe('segmenterOutputSchema', () => {
  const VALID = {
    episodeId: 'abc',
    durationSec: 3600,
    segments: [{ startSec: 0, endSec: 60, topic: 'market', headline: 'h', relevance: 0.9 }],
    keptTopics: ['market'],
    droppedMinutes: { joke: 0, ad: 0, chitchat: 0, other: 0 },
  }
  it('shouldAcceptValid', () => {
    expect(() => SegmenterOutputSchema.parse(VALID)).not.toThrow()
  })
  it('shouldRejectEmptySegments', () => {
    expect(() => SegmenterOutputSchema.parse({ ...VALID, segments: [] })).toThrow()
  })
  it('shouldRejectOver50Segments', () => {
    const many = Array.from({ length: 51 }).fill(VALID.segments[0])
    expect(() => SegmenterOutputSchema.parse({ ...VALID, segments: many })).toThrow()
  })
})

describe('eventSchema', () => {
  it('shouldAcceptNullDate', () => {
    expect(() => EventSchema.parse({
      title: 't',
      date: null,
      description: 'd',
      segmentRef: { startSec: 0, endSec: 60 },
    })).not.toThrow()
  })
  it('shouldRejectInvalidDateFormat', () => {
    expect(() => EventSchema.parse({
      title: 't',
      date: '2026/04/22',
      description: 'd',
      segmentRef: { startSec: 0, endSec: 60 },
    })).toThrow()
  })
})

describe('entitySchema', () => {
  it('shouldAcceptSectorEntity', () => {
    expect(() => EntitySchema.parse({
      kind: 'sector',
      name: '半導體',
      mentionCount: 3,
      context: 'x',
    })).not.toThrow()
  })
  it('shouldRejectTickerKindBecauseNotAllowed', () => {
    expect(() => EntitySchema.parse({
      kind: 'ticker',
      name: '2330',
      mentionCount: 5,
      context: 'x',
    })).toThrow()
  })
})

describe('reasoningChainSchema', () => {
  it('shouldRequireAtLeast2Steps', () => {
    expect(() => ReasoningChainSchema.parse({
      premise: 'a',
      steps: ['x'],
      conclusion: 'c',
      confidence: 'high',
    })).toThrow()
  })
  it('shouldAcceptValidChain', () => {
    expect(() => ReasoningChainSchema.parse({
      premise: 'a',
      steps: ['x', 'y', 'z'],
      conclusion: 'c',
      confidence: 'medium',
    })).not.toThrow()
  })
})

describe('impactSchema', () => {
  it('shouldAcceptSectorLevelImpact', () => {
    expect(() => ImpactSchema.parse({
      sector: '航運',
      direction: 'positive',
      timeHorizon: 'short',
      reasoning: 'r',
    })).not.toThrow()
  })
})

describe('analystFrameSchema', () => {
  it('shouldAcceptPrimaryStrength', () => {
    expect(() => AnalystFrameSchema.parse({
      framePattern: '油價 → 通膨 → FED 鷹',
      whenApplicable: 'x',
      exampleQuote: '「通膨偏高」',
      strength: 'primary',
    })).not.toThrow()
  })
  it('shouldRejectExampleQuoteOver300Chars', () => {
    expect(() => AnalystFrameSchema.parse({
      framePattern: 'p',
      whenApplicable: 'w',
      exampleQuote: '一'.repeat(301),
      strength: 'primary',
    })).toThrow()
  })
})

describe('citedSourceSchema', () => {
  it('shouldAcceptValidTypes', () => {
    for (const type of ['gov', 'academic', 'media', 'corporate', 'market_data', 'other'] as const) {
      expect(() => CitedSourceSchema.parse({ name: 'x', type, context: 'y' })).not.toThrow()
    }
  })
})
