import type { CascadeChain } from '@suanomics/shared'
import { CascadeChainSchema, EvidenceClaimSchema } from '@suanomics/shared'
import { z } from 'zod'

// Re-export so existing api code that imports from './types.js' continues to work
export { CascadeChainSchema }
export type { CascadeChain }

// CascadeHypothesis: Decomposer 輸出每條連動鏈的假設
export const CascadeHypothesisSchema = z.object({
  industry: z.string().min(1),
  mechanism: z.string().min(1),
  retrieveQuery: z.object({
    entities: z.array(z.string()).optional(),
    topics: z.array(z.string()).optional(),
    days: z.number().int().positive().default(7),
  }),
})

// DecomposerOutput: 對單則新聞的拆解結果
export const DecomposerOutputSchema = z.object({
  primaryEntity: z.object({
    name: z.string().min(1),
    kind: z.string().min(1),
  }),
  topicTags: z.array(z.string()).max(5),
  cascadeHypotheses: z.array(CascadeHypothesisSchema).min(0).max(6),
})
export type DecomposerOutput = z.infer<typeof DecomposerOutputSchema>

// AnalystOutput: Analyst 對單則新聞 + retrieve 結果的分析
export const AnalystOutputSchema = z.object({
  newsId: z.string().optional(),
  primaryImpact: z.string().min(1),
  cascadeChains: z.array(CascadeChainSchema),
  reasoning: z.string().min(1),
  // tier1 額外輸出的 claim ledger，**下游先不消費**。
  // `.default([])` 而非 optional：既有呼叫端與測試的 AnalystOutput 字面量都沒有這個欄位，
  // 且下游拿到的一律是陣列、不必到處判 undefined。
  claims: z.array(EvidenceClaimSchema).default([]),
})
export type AnalystOutput = z.infer<typeof AnalystOutputSchema>

// Retriever 內部型別（純 SQL、無 Zod schema 需求）
export interface RetrievedArticle {
  id: string
  url: string
  title: string
  contentSummary: string | null
  entities: unknown[]
  topicTags: string[]
  fetchedAt: string
}
