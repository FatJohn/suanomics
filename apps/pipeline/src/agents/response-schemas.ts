import { z } from 'zod'
import { ITEM_CATEGORIES } from '../db/news-categories.js'

// LLM 回應的形狀，傳給 Output.object。刻意不放長度與數量限制：Zod 版本會在 SDK 端嚴格驗證，
// 超限就整筆丟失；限制留給各 agent 的 normalize 與領域 schema，它們會截斷或降級。

const CitationSchema = z.object({ url: z.string(), title: z.string(), quote: z.string() })
const ChainBase = {
  industry: z.string(),
  mechanism: z.string(),
  affectedTickers: z.array(z.string()),
  direction: z.enum(['positive', 'neutral', 'negative']),
  citations: z.array(CitationSchema),
}
const AnalystBase = { newsId: z.string().optional(), primaryImpact: z.string(), reasoning: z.string() }

export const NewsTaggerResponse = z.object({
  results: z.array(z.object({ id: z.number().int(), tags: z.array(z.string()) })),
})

export const NewsCategorizerResponse = z.object({
  results: z.array(z.object({ id: z.number().int(), category: z.enum(ITEM_CATEGORIES) })),
})

export const ChainGrouperResponse = z.object({
  mapping: z.array(z.object({ label: z.string(), force: z.string() })),
})

export const CorpusEntitySummaryResponse = z.object({
  contentSummary: z.string(),
  entities: z.array(z.object({
    kind: z.enum(['company', 'ticker', 'sector', 'macro', 'other']),
    name: z.string(),
    confidence: z.number(),
  })),
  topicTags: z.array(z.string()),
})

export const DecomposerResponse = z.object({
  primaryEntity: z.object({ name: z.string(), kind: z.string() }),
  topicTags: z.array(z.string()),
  cascadeHypotheses: z.array(z.object({
    industry: z.string(),
    mechanism: z.string(),
    retrieveQuery: z.object({
      entities: z.array(z.string()).optional(),
      topics: z.array(z.string()).optional(),
      days: z.number().int().optional(),
    }),
  })),
})

export const AnalystTier1Response = z.object({
  ...AnalystBase,
  cascadeChains: z.array(z.object({ ...ChainBase, nextTierEntities: z.array(z.string()).optional() })),
})

export const AnalystTier1WithClaimsResponse = AnalystTier1Response.extend({
  claims: z.array(z.object({
    kind: z.enum(['fact', 'inference', 'scenario']),
    claimType: z.enum(['named-number', 'dated-event', 'causal']),
    claim: z.string(),
    evidenceRefs: z.array(z.object({
      kind: z.enum(['citation', 'series']),
      url: z.string().optional(),
      seriesId: z.string().optional(),
      asOf: z.string().optional(),
    })),
  })).optional(),
})

// 不含 nextTierEntities：tier 2 的 chain 不得再展開下一層，遞迴深度靠形狀鎖在 2。
export const AnalystTier2Response = z.object({ ...AnalystBase, cascadeChains: z.array(z.object(ChainBase)) })

export const SynthesizerResponse = z.object({
  headline: z.string(),
  summary: z.string(),
  relatedNews: z.array(z.object({
    newsId: z.string(),
    relationType: z.enum(['cause', 'effect', 'context', 'contrast']),
    reasoning: z.string(),
  })),
  affectedIndustries: z.array(z.object({
    name: z.string(),
    direction: z.enum(['positive', 'negative', 'mixed', 'uncertain']),
    confidence: z.enum(['high', 'medium', 'low']),
    reasoning: z.string(),
  })),
  relatedETFs: z.array(z.object({ ticker: z.string(), name: z.string(), rationale: z.string() })),
  reasoningChain: z.array(z.string()),
})

export const EditorResponse = z.object({
  mainThemes: z.array(z.string()),
  dailyThesis: z.string(),
  selectedNewsIds: z.array(z.number().int()),
  storylineTouches: z.array(z.object({
    storylineId: z.number().int(),
    valence: z.enum(['support', 'challenge', 'extend']),
    note: z.string(),
  })),
  resolveStorylines: z.array(z.object({
    storylineId: z.number().int(),
    disposition: z.enum(['confirmed', 'refuted']),
    note: z.string(),
  })).optional(),
  newStorylines: z.array(z.object({ title: z.string(), thesis: z.string(), entities: z.array(z.string()) })),
})

export const ViewpointsPointsResponse = z.object({ points: z.array(z.string()) })
export const ViewpointsNetReadResponse = z.object({ netRead: z.string() })

// claimIds 與 relatedNewsIds 刻意 optional：沒東西可掛時省略，不要為了滿足 schema 硬掰 id。
export const NarrativeWriterResponse = z.object({
  intro: z.string(),
  sections: z.array(z.object({
    heading: z.string(),
    takeaway: z.string(),
    body: z.string(),
    relatedNewsIds: z.array(z.string()).optional(),
    claimIds: z.array(z.string()).optional(),
    citationUrls: z.array(z.string()),
  })),
  outro: z.string(),
})

export const PodcastWriterResponse = z.object({
  briefDate: z.string(),
  hook: z.object({ headline: z.string(), body: z.string() }),
  acts: z.array(z.object({
    actTitle: z.string(),
    storyline: z.string(),
    body: z.string(),
    citationUrls: z.array(z.string()),
    relatedNewsIds: z.array(z.string()),
  })),
  takeaway: z.object({ body: z.string() }),
  meta: z.object({ totalChars: z.number(), persona: z.string(), generatedAt: z.string() }),
})
