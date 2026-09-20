import { z } from 'zod'

// ===== Segmenter =====

// knip-ignore -- re-exported via yt-transcript/index.ts public API surface
export const SegmentTopicSchema = z.enum([
  'market',
  'macro_event',
  'joke',
  'ad',
  'chitchat',
  'other',
])
export type SegmentTopic = z.infer<typeof SegmentTopicSchema>

export const SegmentSchema = z.object({
  startSec: z.number().int().nonnegative(),
  endSec: z.number().int().positive(),
  topic: SegmentTopicSchema,
  headline: z.string().min(1).max(100),
  relevance: z.number().min(0).max(1),
})
export type Segment = z.infer<typeof SegmentSchema>

export const SegmenterOutputSchema = z.object({
  episodeId: z.string(),
  durationSec: z.number().int().positive(),
  segments: z.array(SegmentSchema).min(1).max(50),
  keptTopics: z.array(SegmentTopicSchema),
  droppedMinutes: z.object({
    joke: z.number().nonnegative(),
    ad: z.number().nonnegative(),
    chitchat: z.number().nonnegative(),
    other: z.number().nonnegative(),
  }),
})
export type SegmenterOutput = z.infer<typeof SegmenterOutputSchema>

// ===== Lens: Events =====

export const EventSchema = z.object({
  title: z.string().min(1).max(120),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  description: z.string().max(400),
  segmentRef: z.object({
    startSec: z.number().int().nonnegative(),
    endSec: z.number().int().positive(),
  }),
})
export type Event = z.infer<typeof EventSchema>

export const EventsLensSchema = z.object({
  episodeId: z.string(),
  events: z.array(EventSchema).max(15),
})
export type EventsLens = z.infer<typeof EventsLensSchema>

// ===== Lens: Cited sources =====

export const CitedSourceSchema = z.object({
  name: z.string().min(1).max(120),
  type: z.enum(['gov', 'academic', 'media', 'corporate', 'market_data', 'other']),
  context: z.string().max(200),
})
export type CitedSource = z.infer<typeof CitedSourceSchema>

export const CitedSourcesLensSchema = z.object({
  episodeId: z.string(),
  sources: z.array(CitedSourceSchema).max(20),
})
export type CitedSourcesLens = z.infer<typeof CitedSourcesLensSchema>

// ===== Lens: Entities (sector-level only, 合規) =====

export const EntitySchema = z.object({
  kind: z.enum(['sector', 'macro_indicator', 'country_region', 'commodity']),
  name: z.string().min(1).max(80),
  mentionCount: z.number().int().positive(),
  context: z.string().max(200),
})
export type Entity = z.infer<typeof EntitySchema>

export const EntitiesLensSchema = z.object({
  episodeId: z.string(),
  entities: z.array(EntitySchema).max(20),
})
export type EntitiesLens = z.infer<typeof EntitiesLensSchema>

// ===== Lens: Reasoning chains =====

export const ReasoningChainSchema = z.object({
  premise: z.string().max(200),
  steps: z.array(z.string().max(150)).min(2).max(6),
  conclusion: z.string().max(200),
  confidence: z.enum(['high', 'medium', 'low']),
})
export type ReasoningChain = z.infer<typeof ReasoningChainSchema>

export const ReasoningChainsLensSchema = z.object({
  episodeId: z.string(),
  chains: z.array(ReasoningChainSchema).max(10),
})
export type ReasoningChainsLens = z.infer<typeof ReasoningChainsLensSchema>

// ===== Lens: Impacts (sector-level) =====

export const ImpactSchema = z.object({
  sector: z.string().min(1).max(60),
  direction: z.enum(['positive', 'negative', 'mixed', 'uncertain']),
  timeHorizon: z.enum(['short', 'medium', 'long']),
  reasoning: z.string().max(250),
})
export type Impact = z.infer<typeof ImpactSchema>

export const ImpactsLensSchema = z.object({
  episodeId: z.string(),
  impacts: z.array(ImpactSchema).max(12),
})
export type ImpactsLens = z.infer<typeof ImpactsLensSchema>

// ===== Lens: Analyst frames =====

export const AnalystFrameSchema = z.object({
  framePattern: z.string().min(1).max(150),
  whenApplicable: z.string().max(200),
  exampleQuote: z.string().min(1).max(300),
  strength: z.enum(['primary', 'secondary', 'passing']),
})
export type AnalystFrame = z.infer<typeof AnalystFrameSchema>

export const AnalystFramesLensSchema = z.object({
  episodeId: z.string(),
  frames: z.array(AnalystFrameSchema).max(8),
})
export type AnalystFramesLens = z.infer<typeof AnalystFramesLensSchema>

// ===== Per-episode aggregated =====

export const EpisodeL3Schema = z.object({
  episodeId: z.string(),
  title: z.string(),
  url: z.string().url(),
  publishedAt: z.string().datetime(),
  durationSec: z.number().int().nonnegative(),
  segmenter: SegmenterOutputSchema,
  events: z.array(EventSchema),
  citedSources: z.array(CitedSourceSchema),
  entities: z.array(EntitySchema),
  reasoningChains: z.array(ReasoningChainSchema),
  impacts: z.array(ImpactSchema),
  analystFrames: z.array(AnalystFrameSchema),
})
export type EpisodeL3 = z.infer<typeof EpisodeL3Schema>
