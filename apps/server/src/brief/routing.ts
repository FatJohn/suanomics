import type { CachedAnalysis } from '@suanomics/db/repos/analyses-repo'
import type { AliasMap } from '../agents/entity-aliases.js'
import type { DecomposerOutput, RetrievedArticle } from '../agents/types.js'
import type { AnalyzeInput } from './cache-key.js'
import {

  findCachedByInputHash as defaultFindByHash,
  findCachedByEntityOverlap as defaultFindByOverlap,
} from '@suanomics/db/repos/analyses-repo'
import {

  extractCanonicalEntities,
  getDefaultAliasMap,
} from '../agents/entity-aliases.js'
import { computeInputHash } from './cache-key.js'

export type RoutingMode = 'cache-hit' | 'db-related' | 'gap-scrape' | 'full-pipeline'

export type RoutingDecision
  = | { mode: 'cache-hit', cached: CachedAnalysis }
    | { mode: 'db-related', inputCanonical: string[], cachedNeighbors: CachedAnalysis[] }
    | { mode: 'gap-scrape', inputCanonical: string[], existingDbArticles: RetrievedArticle[] }
    | { mode: 'full-pipeline' }

export interface RoutingDeps {
  aliasMap?: AliasMap
  findCachedByInputHash?: (h: string) => Promise<CachedAnalysis | null>
  findCachedByEntityOverlap?: (
    canonical: string[],
    windowDays: number,
    limit: number,
  ) => Promise<CachedAnalysis[]>
}

const ENTITY_OVERLAP_THRESHOLD = 0.6
const ENTITY_MIN_FOR_ROUTING = 2
const DB_RELATED_WINDOW_DAYS = 7
const DB_RELATED_LOOKUP_LIMIT = 20

export async function decideRouting(
  input: AnalyzeInput,
  deps?: RoutingDeps,
): Promise<RoutingDecision> {
  const aliasMap = deps?.aliasMap ?? getDefaultAliasMap()
  const findByHash = deps?.findCachedByInputHash ?? defaultFindByHash
  const findByOverlap = deps?.findCachedByEntityOverlap ?? defaultFindByOverlap

  // Step 1: cache-hit
  const inputHash = computeInputHash(input)
  const cached = await findByHash(inputHash)
  if (cached)
    return { mode: 'cache-hit', cached }

  // Step 2: heuristic entity extract
  const inputCanonical = extractCanonicalEntities(
    `${input.title ?? ''}\n${input.content ?? ''}`,
    aliasMap,
  )
  if (inputCanonical.length < ENTITY_MIN_FOR_ROUTING)
    return { mode: 'full-pipeline' }

  // Step 3: db-related lookup
  const candidates = await findByOverlap(
    inputCanonical,
    DB_RELATED_WINDOW_DAYS,
    DB_RELATED_LOOKUP_LIMIT,
  )
  const inputSet = new Set(inputCanonical)
  const neighbors = candidates.filter((c) => {
    const cachedSet = new Set(c.entities)
    const intersect = [...inputSet].filter(e => cachedSet.has(e)).length
    const denom = Math.min(inputSet.size, cachedSet.size)
    return denom > 0 && intersect / denom >= ENTITY_OVERLAP_THRESHOLD
  })
  if (neighbors.length >= 1)
    return { mode: 'db-related', inputCanonical, cachedNeighbors: neighbors }

  // Step 4: gap-scrape (entity >= 2 but 60% miss)
  return {
    mode: 'gap-scrape',
    inputCanonical,
    existingDbArticles: candidates.map(toRetrievedArticleShape),
  }
}

function toRetrievedArticleShape(c: CachedAnalysis): RetrievedArticle {
  return {
    id: `cached-${c.id}`,
    url: `analyses://${c.id}`,
    title: '（DB 弱相關 cached analysis）',
    contentSummary: '',
    entities: [],
    topicTags: c.entities,
    fetchedAt: new Date().toISOString(),
  }
}

// 給 worker gap-scrape / db-related dispatcher 用、拼一個最小 DecomposerOutput
// 餵 callAnalystTier1（callAnalystTier1 的 formatUserContent 印 decomposed.primaryEntity /
// topicTags / cascadeHypotheses 段、cascadeHypotheses 留空陣列即可）
export function synthesizeDecomposedFromHeuristic(canonical: string[]): DecomposerOutput {
  return {
    primaryEntity: { name: canonical[0] ?? 'unknown', kind: 'topic' },
    topicTags: canonical.slice(0, 5),
    cascadeHypotheses: [],
  }
}
