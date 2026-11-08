import { truncateString } from './_truncate.js'

// 兩個 tier 的 Analyst Gemini RESPONSE_SCHEMA 都允許 citations[].quote 自由長度、
// 但實際存 DB / API surface 限定每段 quote ≤ 600 字、避免 Gemini 把整段 article 塞進來。
// 在 schema-parse 之前先 clamp、shared by tier1 / tier2。
export function normalizeForAnalystSchema(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object')
    return raw
  const r = raw as Record<string, unknown>
  if (!Array.isArray(r.cascadeChains))
    return raw
  return {
    ...r,
    cascadeChains: r.cascadeChains.map((c) => {
      if (!c || typeof c !== 'object')
        return c
      const chain = c as Record<string, unknown>
      if (!Array.isArray(chain.citations))
        return chain
      return {
        ...chain,
        citations: chain.citations.map((cit) => {
          if (!cit || typeof cit !== 'object')
            return cit
          const node = cit as Record<string, unknown>
          return { ...node, quote: truncateString(node.quote, 600) }
        }),
      }
    }),
  }
}
