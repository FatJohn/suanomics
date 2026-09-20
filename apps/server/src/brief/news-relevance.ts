// 相關性感知選稿評分器（純函式、無 LLM、無 RAG）。
// score = sourceWeight(slug) × (W_RECENCY·recencyDecay + W_STORYLINE·storylineAffinity + W_LINKAGE·crossNewsLinkage)

import type { RelevanceCandidate } from '@suanomics/db/repos/news-repo'
import type { Storyline } from '@suanomics/db/repos/storylines-repo'
import type { AliasMap } from '../agents/entity-aliases.js'
import { ITEM_CATEGORIES } from '@suanomics/db/news-categories'
import { canonicalizeEntities, extractCanonicalEntities } from '../agents/entity-aliases.js'

// ── 可調 config 常數（集中、看真實輸出後微調）──
export const CAP_DAYS = 14 // sanity cap：>14 天不進候選池（對齊 storyline 14 天 dormancy）
export const HALF_LIFE_DAYS = 3
export const AFFINITY_CAP = 3
export const LINKAGE_CAP = 5
export const W_RECENCY = 1.0
export const W_STORYLINE = 1.2
export const W_LINKAGE = 0.6
export const TOP_K = 36
export const FLOOR_PER_CATEGORY = 4
export const STORY_DEDUP_JACCARD = 0.5 // story-level 去重門檻：canonical 實體 Jaccard ≥ 此值視為同事件（eval 可調）
export const CAP_PER_STORYLINE = 4 // 單一 open storyline 在 top-36 的格數上限（spike M=4 最佳、Stage 2 可調）

const MS_PER_DAY = 86_400_000

// age 以 briefDate 00:00Z 為基準；publishedAt 缺值退 fetchedAt；負值（發布晚於 briefDate）clamp 0。
// briefDate 須為已驗證的 YYYY-MM-DD（邊界已於 getRelevanceCandidates 以 regex 驗證、純函式不重複防呆）。
export function computeAgeDays(candidate: { publishedAt: Date | null, fetchedAt: Date }, briefDate: string): number {
  const ref = new Date(`${briefDate}T00:00:00Z`).getTime()
  const ts = (candidate.publishedAt ?? candidate.fetchedAt).getTime()
  return Math.max(0, (ref - ts) / MS_PER_DAY)
}

// 指數衰減：每 halfLife 天減半。range (0, 1]。
export function recencyDecay(ageDays: number, halfLife: number = HALF_LIFE_DAYS): number {
  return 0.5 ** (ageDays / halfLife)
}

// 每條 storyline 的 canonical 實體集（entities[] + title/thesis 掃出的補強）。不跨 storyline union。
export function buildPerStorylineEntitySets(storylines: readonly Storyline[], aliasMap: AliasMap): { id: number, entities: Set<string> }[] {
  return storylines.map((s) => {
    const set = new Set<string>()
    for (const e of canonicalizeEntities(s.entities, aliasMap))
      set.add(e)
    for (const e of extractCanonicalEntities(`${s.title} ${s.thesis}`, aliasMap))
      set.add(e)
    return { id: s.id, entities: set }
  })
}

// 把候選指派給交集最大的 open storyline：≥1 命中才算、平手取最小 storyline id；零命中回 null（冷門 distinct、永不 cap）。
// 用候選的 alias 實體（與 scoring 的 affinity 同一組、語意一致）。
export function assignStoryline(
  entities: readonly string[],
  perStorylineSets: ReadonlyArray<{ id: number, entities: ReadonlySet<string> }>,
): number | null {
  const ents = new Set(entities)
  let bestId: number | null = null
  let bestOverlap = 0
  for (const s of perStorylineSets) {
    let overlap = 0
    for (const e of ents) {
      if (s.entities.has(e))
        overlap++
    }
    if (overlap === 0)
      continue
    if (overlap > bestOverlap || (overlap === bestOverlap && (bestId === null || s.id < bestId))) {
      bestOverlap = overlap
      bestId = s.id
    }
  }
  return bestId
}

// open storylines 的 canonical 實體 union（scoring 的 affinity 用）。＝所有 per-storyline 集合的聯集。
export function buildStorylineEntitySet(storylines: readonly Storyline[], aliasMap: AliasMap): Set<string> {
  const union = new Set<string>()
  for (const { entities } of buildPerStorylineEntitySets(storylines, aliasMap)) {
    for (const e of entities)
      union.add(e)
  }
  return union
}

// 新聞與 storyline 實體集的重疊數 / AFFINITY_CAP（≥cap 算滿分、saturating）。
export function storylineAffinity(newsEntities: readonly string[], storylineEntitySet: ReadonlySet<string>, cap: number = AFFINITY_CAP): number {
  let matches = 0
  for (const e of newsEntities) {
    if (storylineEntitySet.has(e))
      matches++
  }
  return Math.min(matches, cap) / cap
}

// 候選池 document frequency：每個 canonical entity 出現在幾則候選（單則內 dedupe）。
export function buildDocFrequency(entitiesPerCandidate: readonly (readonly string[])[]): Map<string, number> {
  const df = new Map<string, number>()
  for (const ents of entitiesPerCandidate) {
    for (const e of new Set(ents))
      df.set(e, (df.get(e) ?? 0) + 1)
  }
  return df
}

// 熱點加分：新聞的實體在「其他」候選出現最多的次數 / LINKAGE_CAP（saturating）。
export function crossNewsLinkage(newsEntities: readonly string[], df: ReadonlyMap<string, number>, cap: number = LINKAGE_CAP): number {
  let maxOther = 0
  for (const e of newsEntities) {
    const other = (df.get(e) ?? 0) - 1
    if (other > maxOther)
      maxOther = other
  }
  return Math.min(maxOther, cap) / cap
}

// 來源品質乘數（無 DB 欄、code config）。未列 slug → 1.0。範圍 0.9–1.1 當溫和 tiebreaker。
//
// 扣分／加分有**兩個**互相獨立的維度，只是共用同一個區間：
//  1. 來源型態：泛關鍵字 Google News 搜尋雜訊多（0.9）、直接出版社/官方 feed 乾淨（1.1）。
//  2. 內容調性：`nextapple-finance` 是直連出版社 feed，照維度 1 該給 1.1，但財經內容
//     調性偏軟，所以壓到 0.9（2026-08-28 加入時的決定）。
//
// ★ 所以**不能**從權重值反推來源型態——0.9 可能是雜訊多，也可能是調性軟。
// 未列名的直連來源（`google-news-cnyes`／`-udn`／`-yahoo-stock` 換直連後仍是 1.0）
// 是待決不是遺漏：照維度 1 它們該升 1.1，但改權重要配 eval。
export const SOURCE_WEIGHTS: Record<string, number> = {
  'cna': 1.1,
  'ltn-business': 1.1,
  'eia': 1.1,
  'oilprice': 1.1,
  'cnbc-markets': 1.1,
  'nextapple-finance': 0.9,
  'google-news-fin': 0.9,
  'google-news-us-macro': 0.9,
  'google-news-oil': 0.9,
  'google-news-cbc': 0.9,
  'google-news-china': 0.9,
}

export function sourceWeight(slug: string): number {
  return SOURCE_WEIGHTS[slug] ?? 1.0
}

export interface ScoringContext {
  storylineEntitySet: ReadonlySet<string>
  df: ReadonlyMap<string, number>
  briefDate: string
}

// 加總式：source 乘數 × (recency 衰減項 + storyline 加分 + linkage 加分)。
// newsEntities 由 caller 預抽（rankAndSelect 一次抽、df 與此共用）。
export function scoreCandidate(candidate: RelevanceCandidate, newsEntities: readonly string[], ctx: ScoringContext): number {
  const recency = recencyDecay(computeAgeDays(candidate, ctx.briefDate))
  const affinity = storylineAffinity(newsEntities, ctx.storylineEntitySet)
  const linkage = crossNewsLinkage(newsEntities, ctx.df)
  const relevance = W_RECENCY * recency + W_STORYLINE * affinity + W_LINKAGE * linkage
  return sourceWeight(candidate.sourceSlug) * relevance
}

export interface RankContext {
  storylines: readonly Storyline[]
  aliasMap: AliasMap
  briefDate: string
}

interface Scored { candidate: RelevanceCandidate, score: number, storylineId?: number | null }

// 穩定排序：score 降序、同分 id 升序（determinism、測試可預期）。
function byScoreDesc(a: Scored, b: Scored): number {
  return b.score - a.score || a.candidate.id - b.candidate.id
}

// 集合 Jaccard 相似度：|a∩b| / |a∪b|。兩者皆空回 0（不視為相同）。
export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0)
    return 0
  let inter = 0
  for (const x of a) {
    if (b.has(x))
      inter++
  }
  const union = a.size + b.size - inter
  return union === 0 ? 0 : inter / union
}

// story-level 去重的群：代表的比對實體集 + 原始實體陣列（往下流給 scoring、保留原行為）+ 代表候選 + base-score。
interface StoryCluster {
  set: Set<string>
  entities: readonly string[]
  candidate: RelevanceCandidate
  base: number
}

// 評分前去重：把講同一事件的近重複候選（clusterEntities Jaccard ≥ threshold）收斂、每群留 base-score 最高代表。
// base = sourceWeight × recency（刻意不含 storyline/linkage/df、避免用待修正的灌水分數挑代表）。
// 聚類鍵 clusterEntities 與往下流的 entities 分離：聚類可用 topic_tags、entities 仍供 scoring。
// 空 clusterEntities 候選永不合併（無法判斷是否同事件）。greedy first-match、依輸入順序；每群最終留 max base-score 者。
export function dedupeByStory(
  items: ReadonlyArray<{ candidate: RelevanceCandidate, clusterEntities: readonly string[], entities: readonly string[] }>,
  briefDate: string,
  threshold: number = STORY_DEDUP_JACCARD,
): Array<{ candidate: RelevanceCandidate, entities: readonly string[] }> {
  const clusters: StoryCluster[] = []
  for (const item of items) {
    const set = new Set(item.clusterEntities)
    const base = sourceWeight(item.candidate.sourceSlug) * recencyDecay(computeAgeDays(item.candidate, briefDate))
    if (set.size === 0) {
      clusters.push({ set, entities: item.entities, candidate: item.candidate, base })
      continue
    }
    let matched: StoryCluster | undefined
    for (const cl of clusters) {
      if (cl.set.size === 0)
        continue
      if (jaccard(set, cl.set) >= threshold) {
        matched = cl
        break
      }
    }
    if (!matched) {
      clusters.push({ set, entities: item.entities, candidate: item.candidate, base })
      continue
    }
    if (base > matched.base || (base === matched.base && item.candidate.id < matched.candidate.id)) {
      matched.set = set
      matched.entities = item.entities
      matched.candidate = item.candidate
      matched.base = base
    }
  }
  return clusters.map(cl => ({ candidate: cl.candidate, entities: cl.entities }))
}

// 從已評分候選選出 top-K：每類保底 floorPerCategory（類內按 score）→ 全域 score 補滿到 topK。
// capPerStoryline 有給時：同一 storylineId 在 floor/補滿階段最多 cap 格；storylineId 為 null 永不 cap；
// cap 後不足 topK 則放寬 cap、按 score backfill（不交不足量給 editor）。
// caller 須保證 floorPerCategory × categories ≤ topK（rankAndSelect 已 guard）。
export function selectTopK(
  scored: readonly Scored[],
  opts: { topK: number, floorPerCategory: number, capPerStoryline?: number },
): RelevanceCandidate[] {
  const { topK, floorPerCategory: floor, capPerStoryline } = opts
  const sorted = [...scored].sort(byScoreDesc)
  const selectedIds = new Set<number>()
  const storyCount = new Map<number, number>()
  const out: Scored[] = []

  const capped = (s: Scored): boolean => {
    if (capPerStoryline === undefined || s.storylineId == null)
      return false
    return (storyCount.get(s.storylineId) ?? 0) >= capPerStoryline
  }
  const take = (s: Scored): void => {
    selectedIds.add(s.candidate.id)
    out.push(s)
    if (s.storylineId != null)
      storyCount.set(s.storylineId, (storyCount.get(s.storylineId) ?? 0) + 1)
  }

  // step1：每類保底（受 cap 限制）
  for (const cat of ITEM_CATEGORIES) {
    let count = 0
    for (const s of sorted) {
      if (count >= floor)
        break
      if (s.candidate.category !== cat || selectedIds.has(s.candidate.id) || capped(s))
        continue
      take(s)
      count++
    }
  }
  // step2：全域 score 補滿到 topK（受 cap 限制）
  for (const s of sorted) {
    if (out.length >= topK)
      break
    if (selectedIds.has(s.candidate.id) || capped(s))
      continue
    take(s)
  }
  // step3：cap 撐不滿 topK → 放寬 cap、按 score backfill
  for (const s of sorted) {
    if (out.length >= topK)
      break
    if (selectedIds.has(s.candidate.id))
      continue
    take(s)
  }

  // 最終按 score 排（step1 floor 會打亂順序）；順序 load-bearing：editor 主軸排前
  out.sort(byScoreDesc)
  return out.map(s => s.candidate)
}

// hybrid top-K：每類保底 floorPerCategory（類內按 score）→ 全域 score 補滿到 topK。
// 注意：floor × 類數 ≤ topK 時 floor 才被完整保證（預設 4×5=20 ≤ 36）。
export function rankAndSelect(candidates: readonly RelevanceCandidate[], ctx: RankContext, opts: { topK?: number, floorPerCategory?: number, capPerStoryline?: number } = {}): RelevanceCandidate[] {
  const topK = opts.topK ?? TOP_K
  const floor = opts.floorPerCategory ?? FLOOR_PER_CATEGORY
  const cap = opts.capPerStoryline ?? CAP_PER_STORYLINE
  if (floor * ITEM_CATEGORIES.length > topK)
    throw new Error(`rankAndSelect: floorPerCategory (${floor}) × ${ITEM_CATEGORIES.length} categories exceeds topK (${topK})`)
  if (candidates.length === 0)
    return []

  // 一次抽每則的 canonical 實體（餵給去重；去重後的子集再供 df 與 scoring 共用、避免重抽）。
  const entitiesByCandidate = candidates.map(c => extractCanonicalEntities(`${c.title} ${c.contentText ?? ''}`, ctx.aliasMap))
  // 聚類鍵優先用 LLM topic_tags（已驗證乾淨分群）、untagged 退回 alias 實體（graceful）。
  // entities 仍是 alias 實體、供 df / scoring（scoring 語意不變、只是 survivor 集由 tags 決定）。
  const itemsWithEntities = candidates.map((c, i) => {
    const aliasEntities = entitiesByCandidate[i] ?? []
    const clusterEntities = c.topicTags && c.topicTags.length > 0 ? c.topicTags : aliasEntities
    return { candidate: c, clusterEntities, entities: aliasEntities }
  })
  // 評分前 story-level 去重：把同事件近重複收斂、避免冗餘佔格 + 灌高 linkage。
  // df 改在去重後算 → crossNewsLinkage 反映「幾個 distinct 故事提到此實體」而非「同題重複抓幾次」。
  const deduped = dedupeByStory(itemsWithEntities, ctx.briefDate)
  const df = buildDocFrequency(deduped.map(d => d.entities))
  // 建一次 per-storyline 集合：union 供 scoring 的 affinity（＝舊 buildStorylineEntitySet）、per-storyline 集合供 assignment。
  const perStorylineSets = buildPerStorylineEntitySets(ctx.storylines, ctx.aliasMap)
  const storylineEntitySet = new Set<string>()
  for (const s of perStorylineSets) {
    for (const e of s.entities)
      storylineEntitySet.add(e)
  }
  const scoringCtx: ScoringContext = { storylineEntitySet, df, briefDate: ctx.briefDate }

  const scored: Scored[] = deduped.map(d => ({
    candidate: d.candidate,
    score: scoreCandidate(d.candidate, d.entities, scoringCtx),
    storylineId: assignStoryline(d.entities, perStorylineSets),
  }))
  return selectTopK(scored, { topK, floorPerCategory: floor, capPerStoryline: cap })
}
