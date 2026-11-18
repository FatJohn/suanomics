// Standard JSON Schema (lowercase `type` values), not Gemini's `@google/genai` `Type`
// enum (uppercase strings). This object is passed to `callLLM` (entity-summary.ts),
// which routes to whichever provider `AGENT_MODELS` picks — when routed to a `claude-*`
// model it lands verbatim in Anthropic's `input_schema`, which requires lowercase
// JSON Schema `type` values. Using the Gemini-specific enum here broke that path.
//
// `propertyOrdering` (both here and on `entities.items`) was a Gemini-only hint for
// field emission order; JSON Schema's `properties` is inherently unordered, so dropping
// it only costs Gemini an ordering nudge, not correctness.
export const entitySummaryResponseSchema = {
  type: 'object',
  properties: {
    contentSummary: { type: 'string' },
    entities: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['company', 'ticker', 'sector', 'macro', 'other'] },
          name: { type: 'string' },
          confidence: { type: 'number' },
        },
        required: ['kind', 'name', 'confidence'],
      },
    },
    topicTags: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  required: ['contentSummary', 'entities', 'topicTags'],
} as const
