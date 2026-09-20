import { describe, expect, it } from 'vitest'
import { entitySummaryResponseSchema } from './entity-summary-response-schema.js'

// `entitySummaryResponseSchema` gets sent to `callLLM` (entity-summary.ts:71), which
// routes to whichever provider `AGENT_MODELS` picks. If it routes to a `claude-*` model,
// this object is dropped straight into Anthropic's `input_schema` (a standard JSON
// Schema, lowercase `"object"`/`"string"`/...), not Gemini's SDK-specific `Type` enum
// (uppercase string values like `"OBJECT"`). Sending uppercase values there is a
// provider-portability bug this test guards against.
function collectTypeValues(node: unknown, out: string[] = []): string[] {
  if (node === null || typeof node !== 'object')
    return out
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === 'type' && typeof value === 'string')
      out.push(value)
    collectTypeValues(value, out)
  }
  return out
}

function collectKeys(node: unknown, out: Set<string> = new Set()): Set<string> {
  if (node === null || typeof node !== 'object')
    return out
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    out.add(key)
    collectKeys(value, out)
  }
  return out
}

describe('entitySummaryResponseSchema', () => {
  it('shouldUseLowercaseJsonSchemaTypeValues', () => {
    const typeValues = collectTypeValues(entitySummaryResponseSchema)
    expect(typeValues.length).toBeGreaterThan(0)
    for (const t of typeValues)
      expect(t).toBe(t.toLowerCase())
  })

  it('shouldNotContainGeminiSpecificPropertyOrdering', () => {
    const keys = collectKeys(entitySummaryResponseSchema)
    expect(keys.has('propertyOrdering')).toBe(false)
  })

  it('shouldPreserveTopLevelRequiredFields', () => {
    expect([...entitySummaryResponseSchema.required].sort()).toEqual(
      ['contentSummary', 'entities', 'topicTags'].sort(),
    )
  })

  it('shouldPreserveEntityItemShape', () => {
    const entityItems = entitySummaryResponseSchema.properties.entities.items
    expect(entityItems.type).toBe('object')
    expect(Object.keys(entityItems.properties).sort()).toEqual(['confidence', 'kind', 'name'].sort())
    expect([...entityItems.required].sort()).toEqual(['confidence', 'kind', 'name'].sort())
  })

  it('shouldPreserveKindEnum', () => {
    const kindField = entitySummaryResponseSchema.properties.entities.items.properties.kind
    expect([...kindField.enum].sort()).toEqual(
      ['company', 'ticker', 'sector', 'macro', 'other'].sort(),
    )
  })

  it('shouldKeepTopicTagsAsStringArray', () => {
    const topicTags = entitySummaryResponseSchema.properties.topicTags
    expect(topicTags.type).toBe('array')
    expect(topicTags.items.type).toBe('string')
  })

  it('shouldKeepConfidenceAsNumber', () => {
    const confidenceField = entitySummaryResponseSchema.properties.entities.items.properties.confidence
    expect(confidenceField.type).toBe('number')
  })

  it('shouldKeepContentSummaryAsString', () => {
    expect(entitySummaryResponseSchema.properties.contentSummary.type).toBe('string')
  })
})
