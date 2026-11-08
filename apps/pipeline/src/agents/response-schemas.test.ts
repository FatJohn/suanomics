import type { z } from 'zod'
import { createAnthropic } from '@ai-sdk/anthropic'
import { generateText, Output } from 'ai'
import { describe, expect, it } from 'vitest'
import * as schemas from './response-schemas.js'

// 12 個 runtime agent（judge 不在每日路徑上）。tier1 與 viewpoints-debate 各有兩個形狀。
const RUNTIME_AGENT_SCHEMAS: [string, z.ZodType][] = [
  ['news-categorizer', schemas.NewsCategorizerResponse],
  ['news-tagger', schemas.NewsTaggerResponse],
  ['chain-grouper', schemas.ChainGrouperResponse],
  ['corpus-entity-summary', schemas.CorpusEntitySummaryResponse],
  ['decomposer', schemas.DecomposerResponse],
  ['analyst-tier1', schemas.AnalystTier1Response],
  ['analyst-tier1 (claims)', schemas.AnalystTier1WithClaimsResponse],
  ['analyst-tier2', schemas.AnalystTier2Response],
  ['synthesizer', schemas.SynthesizerResponse],
  ['editor', schemas.EditorResponse],
  ['viewpoints-debate (points)', schemas.ViewpointsPointsResponse],
  ['viewpoints-debate (netRead)', schemas.ViewpointsNetReadResponse],
  ['narrative-writer', schemas.NarrativeWriterResponse],
  ['podcast-writer', schemas.PodcastWriterResponse],
]

// 官方文件列的 structured outputs 不支援關鍵字；model 的 400 要真端點才看得到，這裡先擋形狀。
const UNSUPPORTED = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength', 'pattern', 'maxItems', 'uniqueItems']

function collectKeywords(node: unknown, found: Set<string>): void {
  if (Array.isArray(node)) {
    node.forEach(n => collectKeywords(n, found))
    return
  }
  if (typeof node !== 'object' || node === null)
    return
  const record = node as Record<string, unknown>
  for (const key of UNSUPPORTED) {
    if (key in record)
      found.add(key)
  }
  if (record.type === 'object' && record.additionalProperties !== false)
    found.add('open-object')
  for (const [key, value] of Object.entries(record)) {
    if (key === 'properties' && typeof value === 'object' && value !== null)
      Object.values(value).forEach(v => collectKeywords(v, found))
    else if (key !== 'properties')
      collectKeywords(value, found)
  }
}

async function captureRequestBody(schema: z.ZodType, model: string): Promise<Record<string, unknown>> {
  let body: Record<string, unknown> = {}
  const provider = createAnthropic({
    apiKey: 'test-key',
    fetch: async (_url, init) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>
      return new Response(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'stop here' } }), { status: 400, headers: { 'content-type': 'application/json' } })
    },
  })
  await generateText({ model: provider(model), prompt: 'x', output: Output.object({ schema }), maxRetries: 0 }).catch(() => undefined)
  return body
}

describe('runtime agent 的 response schema', () => {
  it('涵蓋 12 個 runtime agent', () => {
    expect(new Set(RUNTIME_AGENT_SCHEMAS.map(([n]) => n.split(' ')[0])).size).toBe(12)
  })

  describe.each(['claude-haiku-5-5', 'claude-sonnet-5-5'])('%s', (model) => {
    it.each(RUNTIME_AGENT_SCHEMAS)('%s 走原生 structured output，且沒有不支援的關鍵字', async (_name, schema) => {
      const body = await captureRequestBody(schema, model)
      const format = (body.output_config as { format?: { type: string, schema: unknown } } | undefined)?.format
      expect(format?.type).toBe('json_schema')
      expect(body.tools).toBeUndefined()
      const found = new Set<string>()
      collectKeywords(format?.schema, found)
      expect([...found]).toEqual([])
    })
  })
})
