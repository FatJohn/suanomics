import type { LensName } from './prompts.js'

// 這份 schema 現在是純資料、不依賴任何 SDK：`type` 用標準 JSON Schema 的小寫字串字面值
// （'object'／'string'／'array'／'integer'／'number'）取代 `@google/genai` 的 `Type.OBJECT`
// 等 enum。可行的依據：`apps/server/src/agents/` 底下主 pipeline 的 agent schema 本來就是
// 小寫 `type: 'object'`，原樣穿過 `apps/server/src/agents/providers/gemini.ts` 的
// `responseSchema` 餵給真 Gemini、在部署環境每日執行過（例：`apps/server/src/agents/analyst-tier1.ts`）。
// ★ 過去式是刻意的：這個 repo 目前沒有 prod（見 `docs/operations/deploy.md`）。
//
// `nullable: true`（下面 1 處，`date` 欄位）刻意保留、沒有改寫成標準 JSON Schema 的
// `type: ['string', 'null']`：`nullable` 是 Gemini／OpenAPI 3.0 的寫法，但「Gemini 收不收
// 聯集型別」目前沒有證據——這個 session 刻意不打 AI API（`GEMINI_API_KEY` 故意失效），
// 驗不了就不動。這是本檔目前唯一剩下的非標準欄位。

const SEGMENT_TOPICS = [
  'market',
  'macro_event',
  'joke',
  'ad',
  'chitchat',
  'other',
] as const

const SOURCE_TYPES = [
  'gov',
  'academic',
  'media',
  'corporate',
  'market_data',
  'other',
] as const

const ENTITY_KINDS = [
  'sector',
  'macro_indicator',
  'country_region',
  'commodity',
] as const

const CONFIDENCE_LEVELS = ['high', 'medium', 'low'] as const
const IMPACT_DIRECTIONS = ['positive', 'negative', 'mixed', 'uncertain'] as const
const TIME_HORIZONS = ['short', 'medium', 'long'] as const
const FRAME_STRENGTHS = ['primary', 'secondary', 'passing'] as const

export const segmenterResponseSchema = {
  type: 'object',
  properties: {
    episodeId: { type: 'string' },
    durationSec: { type: 'integer' },
    segments: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          startSec: { type: 'integer' },
          endSec: { type: 'integer' },
          topic: { type: 'string', enum: [...SEGMENT_TOPICS] },
          headline: { type: 'string' },
          relevance: { type: 'number' },
        },
        required: ['startSec', 'endSec', 'topic', 'headline', 'relevance'],
      },
    },
    keptTopics: {
      type: 'array',
      items: { type: 'string', enum: [...SEGMENT_TOPICS] },
    },
    droppedMinutes: {
      type: 'object',
      properties: {
        joke: { type: 'number' },
        ad: { type: 'number' },
        chitchat: { type: 'number' },
        other: { type: 'number' },
      },
      required: ['joke', 'ad', 'chitchat', 'other'],
    },
  },
  required: ['episodeId', 'durationSec', 'segments', 'keptTopics', 'droppedMinutes'],
} as const

const eventsResponseSchema = {
  type: 'object',
  properties: {
    episodeId: { type: 'string' },
    events: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          date: { type: 'string', nullable: true },
          description: { type: 'string' },
          segmentRef: {
            type: 'object',
            properties: {
              startSec: { type: 'integer' },
              endSec: { type: 'integer' },
            },
            required: ['startSec', 'endSec'],
          },
        },
        required: ['title', 'date', 'description', 'segmentRef'],
      },
    },
  },
  required: ['episodeId', 'events'],
} as const

const citedSourcesResponseSchema = {
  type: 'object',
  properties: {
    episodeId: { type: 'string' },
    sources: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          type: { type: 'string', enum: [...SOURCE_TYPES] },
          context: { type: 'string' },
        },
        required: ['name', 'type', 'context'],
      },
    },
  },
  required: ['episodeId', 'sources'],
} as const

const entitiesResponseSchema = {
  type: 'object',
  properties: {
    episodeId: { type: 'string' },
    entities: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: [...ENTITY_KINDS] },
          name: { type: 'string' },
          mentionCount: { type: 'integer' },
          context: { type: 'string' },
        },
        required: ['kind', 'name', 'mentionCount', 'context'],
      },
    },
  },
  required: ['episodeId', 'entities'],
} as const

const reasoningChainsResponseSchema = {
  type: 'object',
  properties: {
    episodeId: { type: 'string' },
    chains: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          premise: { type: 'string' },
          steps: { type: 'array', items: { type: 'string' } },
          conclusion: { type: 'string' },
          confidence: { type: 'string', enum: [...CONFIDENCE_LEVELS] },
        },
        required: ['premise', 'steps', 'conclusion', 'confidence'],
      },
    },
  },
  required: ['episodeId', 'chains'],
} as const

const impactsResponseSchema = {
  type: 'object',
  properties: {
    episodeId: { type: 'string' },
    impacts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          sector: { type: 'string' },
          direction: { type: 'string', enum: [...IMPACT_DIRECTIONS] },
          timeHorizon: { type: 'string', enum: [...TIME_HORIZONS] },
          reasoning: { type: 'string' },
        },
        required: ['sector', 'direction', 'timeHorizon', 'reasoning'],
      },
    },
  },
  required: ['episodeId', 'impacts'],
} as const

const analystFramesResponseSchema = {
  type: 'object',
  properties: {
    episodeId: { type: 'string' },
    frames: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          framePattern: { type: 'string' },
          whenApplicable: { type: 'string' },
          exampleQuote: { type: 'string' },
          strength: { type: 'string', enum: [...FRAME_STRENGTHS] },
        },
        required: ['framePattern', 'whenApplicable', 'exampleQuote', 'strength'],
      },
    },
  },
  required: ['episodeId', 'frames'],
} as const

export const LENS_RESPONSE_SCHEMAS: Record<LensName, unknown> = {
  events: eventsResponseSchema,
  cited_sources: citedSourcesResponseSchema,
  entities: entitiesResponseSchema,
  reasoning_chains: reasoningChainsResponseSchema,
  impacts: impactsResponseSchema,
  analyst_frames: analystFramesResponseSchema,
}
