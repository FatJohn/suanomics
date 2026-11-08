import { truncateString } from './_truncate.js'

// 兩個 tier 的 Analyst Gemini RESPONSE_SCHEMA 都允許 citations[].quote 自由長度、
// 但實際存 DB / API surface 限定每段 quote ≤ 600 字、避免 Gemini 把整段 article 塞進來。
// 在 schema-parse 之前先 clamp、shared by tier1 / tier2。
const MAX_CITATIONS = 5

export function normalizeForAnalystSchema(raw: unknown, allowedUrls: ReadonlySet<string>): unknown {
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
        // Anthropic 的 structured output 不強制 maxItems，超量時截斷，不讓整份分析失敗。
        ...(Array.isArray(chain.nextTierEntities) ? { nextTierEntities: chain.nextTierEntities.slice(0, 5) } : {}),
        citations: limitCitations(chain.citations, allowedUrls).map((cit) => {
          if (!cit || typeof cit !== 'object')
            return cit
          const node = cit as Record<string, unknown>
          return { ...node, quote: truncateString(node.quote, 600) }
        }),
      }
    }),
  }
}

// 有來源的排前面再截，真來源不會被幻覺 url 擠掉；沒超量時不動，幻覺檢查才看得到全部。
function limitCitations(citations: unknown[], allowedUrls: ReadonlySet<string>): unknown[] {
  if (citations.length <= MAX_CITATIONS)
    return citations
  const hasSource = (c: unknown): boolean => allowedUrls.has(String((c as { url?: unknown } | null)?.url))
  return [...citations.filter(hasSource), ...citations.filter(c => !hasSource(c))].slice(0, MAX_CITATIONS)
}
