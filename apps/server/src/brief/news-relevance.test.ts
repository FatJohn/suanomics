import type { RelevanceCandidate } from '@suanomics/db/repos/news-repo'
import type { Storyline } from '@suanomics/db/repos/storylines-repo'
import { describe, expect, it } from 'vitest'
import { buildAliasMap, extractCanonicalEntities } from '../agents/entity-aliases.js'
import { assignStoryline, buildDocFrequency, buildPerStorylineEntitySets, buildStorylineEntitySet, computeAgeDays, crossNewsLinkage, dedupeByStory, jaccard, rankAndSelect, recencyDecay, scoreCandidate, selectTopK, sourceWeight, storylineAffinity } from './news-relevance.js'

describe('computeAgeDays', () => {
  it('should return 0 when published on briefDate', () => {
    const c = { publishedAt: new Date('2026-06-15T00:00:00Z'), fetchedAt: new Date('2026-06-15T06:00:00Z') }
    expect(computeAgeDays(c, '2026-06-15')).toBeCloseTo(0, 5)
  })
  it('should return 3 when published three days before briefDate', () => {
    const c = { publishedAt: new Date('2026-06-12T00:00:00Z'), fetchedAt: new Date('2026-06-12T00:00:00Z') }
    expect(computeAgeDays(c, '2026-06-15')).toBeCloseTo(3, 5)
  })
  it('should clamp negative age (published after briefDate) to 0', () => {
    const c = { publishedAt: new Date('2026-06-16T00:00:00Z'), fetchedAt: new Date('2026-06-16T00:00:00Z') }
    expect(computeAgeDays(c, '2026-06-15')).toBe(0)
  })
  it('should fall back to fetchedAt when publishedAt is null', () => {
    const c = { publishedAt: null, fetchedAt: new Date('2026-06-13T00:00:00Z') }
    expect(computeAgeDays(c, '2026-06-15')).toBeCloseTo(2, 5)
  })
})

describe('recencyDecay', () => {
  it('should return 1.0 at age 0', () => {
    expect(recencyDecay(0)).toBe(1)
  })
  it('should halve at one half-life (3 days)', () => {
    expect(recencyDecay(3)).toBeCloseTo(0.5, 5)
  })
  it('should quarter at two half-lives (6 days)', () => {
    expect(recencyDecay(6)).toBeCloseTo(0.25, 5)
  })
})

const aliasMap = buildAliasMap([
  { canonical: 'fed', aliases: ['Fed', 'FOMC', '聯準會'] },
  { canonical: 'tsmc', aliases: ['TSMC', '台積電'] },
  { canonical: 'nvidia', aliases: ['Nvidia', '輝達'] },
  { canonical: 'rate-cut', aliases: ['降息'] },
])

function storyline(partial: Partial<Storyline>): Storyline {
  return { id: 1, title: '', thesis: '', status: 'open', entities: [], updates: [], lastTouchedBriefDate: null, ...partial }
}

describe('buildStorylineEntitySet', () => {
  it('should canonicalize storyline entities (台積電 → tsmc)', () => {
    const set = buildStorylineEntitySet([storyline({ entities: ['台積電'] })], aliasMap)
    expect(set.has('tsmc')).toBe(true)
  })
  it('should include entities mentioned in title/thesis but absent from entities[]', () => {
    const set = buildStorylineEntitySet([storyline({ entities: [], thesis: '聯準會今天可能降息' })], aliasMap)
    expect(set.has('fed')).toBe(true)
    expect(set.has('rate-cut')).toBe(true)
  })
  it('should return empty set when no storylines', () => {
    expect(buildStorylineEntitySet([], aliasMap).size).toBe(0)
  })
})

describe('buildPerStorylineEntitySets', () => {
  it('should build one canonical entity set per storyline (no union across storylines)', () => {
    const sets = buildPerStorylineEntitySets([
      storyline({ id: 7, entities: ['台積電'] }),
      storyline({ id: 9, entities: ['輝達'] }),
    ], aliasMap)
    expect(sets).toHaveLength(2)
    expect(sets[0]).toEqual({ id: 7, entities: new Set(['tsmc']) })
    expect(sets[1]?.entities.has('nvidia')).toBe(true)
  })
  it('should include entities mentioned in title/thesis', () => {
    const sets = buildPerStorylineEntitySets([storyline({ id: 3, entities: [], thesis: '聯準會今天可能降息' })], aliasMap)
    expect(sets[0]?.entities.has('fed')).toBe(true)
    expect(sets[0]?.entities.has('rate-cut')).toBe(true)
  })
  it('should return [] when there are no storylines', () => {
    expect(buildPerStorylineEntitySets([], aliasMap)).toEqual([])
  })
})

describe('storylineAffinity', () => {
  it('should return 0 when news shares no entity with storyline set', () => {
    const set = buildStorylineEntitySet([storyline({ entities: ['台積電'] })], aliasMap)
    const newsEntities = extractCanonicalEntities('今日油價大漲', aliasMap)
    expect(storylineAffinity(newsEntities, set)).toBe(0)
  })
  it('should match across zh/en aliases (news 用 TSMC、storyline 用 台積電)', () => {
    const set = buildStorylineEntitySet([storyline({ entities: ['台積電'] })], aliasMap)
    const newsEntities = extractCanonicalEntities('TSMC 法說會釋出展望', aliasMap)
    expect(storylineAffinity(newsEntities, set)).toBeCloseTo(1 / 3, 5)
  })
  it('should saturate to 1.0 at three or more matches', () => {
    const set = buildStorylineEntitySet([storyline({ entities: ['台積電', 'Fed', '輝達', '降息'] })], aliasMap)
    const newsEntities = extractCanonicalEntities('台積電 Fed 輝達 降息 全到齊', aliasMap)
    expect(storylineAffinity(newsEntities, set)).toBe(1)
  })
  it('should reach 1.0 at exactly three matches (cap boundary)', () => {
    const set = buildStorylineEntitySet([storyline({ entities: ['台積電', 'Fed', '輝達'] })], aliasMap)
    const newsEntities = extractCanonicalEntities('台積電 Fed 輝達 三者', aliasMap)
    expect(storylineAffinity(newsEntities, set)).toBe(1)
  })
})

describe('buildDocFrequency', () => {
  it('should count how many candidates mention each entity (dedupe within a candidate)', () => {
    const df = buildDocFrequency([['fed', 'tsmc'], ['fed'], ['fed', 'fed']])
    expect(df.get('fed')).toBe(3)
    expect(df.get('tsmc')).toBe(1)
  })
})

describe('crossNewsLinkage', () => {
  it('should return 0 for an entity unique to one candidate', () => {
    const df = buildDocFrequency([['nvidia'], ['fed'], ['tsmc']])
    expect(crossNewsLinkage(['nvidia'], df)).toBe(0)
  })
  it('should boost a candidate whose entity recurs across the pool (excludes itself)', () => {
    const df = buildDocFrequency([['fed'], ['fed'], ['fed']])
    expect(crossNewsLinkage(['fed'], df)).toBeCloseTo(2 / 5, 5)
  })
  it('should saturate to 1.0 at the linkage cap', () => {
    const df = buildDocFrequency([['fed'], ['fed'], ['fed'], ['fed'], ['fed'], ['fed'], ['fed']])
    expect(crossNewsLinkage(['fed'], df)).toBe(1)
  })
  it('should return 0 for empty entity list', () => {
    const df = buildDocFrequency([['fed'], ['fed']])
    expect(crossNewsLinkage([], df)).toBe(0)
  })
})

function candidate(partial: Partial<RelevanceCandidate>): RelevanceCandidate {
  return {
    id: 1,
    title: '',
    contentText: '',
    category: 'macro',
    publishedAt: new Date('2026-06-15T00:00:00Z'),
    fetchedAt: new Date('2026-06-15T00:00:00Z'),
    sourceSlug: 'unknown-source',
    topicTags: [],
    ...partial,
  }
}

describe('sourceWeight', () => {
  it('should return 1.0 for an unlisted slug', () => {
    expect(sourceWeight('unknown-source')).toBe(1)
  })
  it('should apply configured weights (0.9 / 1.1)', () => {
    expect(sourceWeight('cna')).toBeCloseTo(1.1, 5)
    expect(sourceWeight('google-news-fin')).toBeCloseTo(0.9, 5)
  })
  // 0.9 這一列的理由與其他 0.9 不同：那些是「泛關鍵字搜尋雜訊多」，這個是直連
  // 出版社 feed（照原本的規則該給 1.1），扣分扣的是內容調性。理由不同但都落在
  // 同一個 0.9–1.1 區間，所以不另開欄位——但表頭的自述必須把這第二個維度寫出來，
  // 否則那張表會自己說謊。
  it('should down-weight a direct feed on tone, not just aggregator noise', () => {
    expect(sourceWeight('nextapple-finance')).toBeCloseTo(0.9, 5)
  })
})

describe('scoreCandidate', () => {
  const storylineEntitySet = new Set(['fed', 'tsmc', 'nvidia'])
  it('should rank a day-8 high-relevance item above a day-0 irrelevant filler', () => {
    const day8 = candidate({ id: 10, publishedAt: new Date('2026-06-07T00:00:00Z'), sourceSlug: 'cna' })
    const day0 = candidate({ id: 11, publishedAt: new Date('2026-06-15T00:00:00Z'), sourceSlug: 'unknown-source' })
    const ctx = { storylineEntitySet, df: new Map<string, number>(), briefDate: '2026-06-15' }
    expect(scoreCandidate(day8, ['fed', 'tsmc', 'nvidia'], ctx)).toBeGreaterThan(scoreCandidate(day0, [], ctx))
  })
  it('should keep a day-0 breaking item competitive via recency floor (score ~= 1.0 at flat source)', () => {
    const day0 = candidate({ id: 12, publishedAt: new Date('2026-06-15T00:00:00Z'), sourceSlug: 'unknown-source' })
    const ctx = { storylineEntitySet: new Set<string>(), df: new Map<string, number>(), briefDate: '2026-06-15' }
    expect(scoreCandidate(day0, [], ctx)).toBeCloseTo(1.0, 5)
  })
  it('should multiply the additive relevance sum by source weight', () => {
    const c = candidate({ id: 13, publishedAt: new Date('2026-06-15T00:00:00Z'), sourceSlug: 'cna' })
    const ctx = { storylineEntitySet: new Set<string>(), df: new Map<string, number>(), briefDate: '2026-06-15' }
    expect(scoreCandidate(c, [], ctx)).toBeCloseTo(1.1, 5)
  })
})

describe('rankAndSelect', () => {
  const ctx = { storylines: [], aliasMap, briefDate: '2026-06-15' }

  it('should return [] for empty input', () => {
    expect(rankAndSelect([], ctx)).toEqual([])
  })
  it('should throw when floorPerCategory × categories exceeds topK', () => {
    expect(() => rankAndSelect([], ctx, { topK: 10, floorPerCategory: 8 })).toThrow(/exceeds topK/)
  })
  it('should return all candidates (score-sorted desc) when fewer than topK', () => {
    const cands = [
      candidate({ id: 1, publishedAt: new Date('2026-06-08T00:00:00Z'), sourceSlug: 'unknown-source' }),
      candidate({ id: 2, publishedAt: new Date('2026-06-15T00:00:00Z'), sourceSlug: 'unknown-source' }),
    ]
    expect(rankAndSelect(cands, ctx).map(c => c.id)).toEqual([2, 1])
  })
  it('should cap total output at topK', () => {
    const cands = Array.from({ length: 50 }, (_, i) =>
      candidate({ id: i + 1, category: 'macro', publishedAt: new Date('2026-06-15T00:00:00Z'), sourceSlug: 'unknown-source' }))
    expect(rankAndSelect(cands, ctx, { topK: 36, floorPerCategory: 4 })).toHaveLength(36)
  })
  it('should guarantee a per-category floor even for a low-relevance category', () => {
    const macro = Array.from({ length: 30 }, (_, i) =>
      candidate({ id: i + 1, category: 'macro', publishedAt: new Date('2026-06-15T00:00:00Z'), sourceSlug: 'unknown-source' }))
    const twOld = candidate({ id: 999, category: 'tw-equity-other', publishedAt: new Date('2026-06-05T00:00:00Z'), sourceSlug: 'unknown-source' })
    const out = rankAndSelect([...macro, twOld], ctx, { topK: 10, floorPerCategory: 2 })
    expect(out.map(c => c.id)).toContain(999)
  })
  it('should output candidates in descending score order', () => {
    const cands = [
      candidate({ id: 1, publishedAt: new Date('2026-06-05T00:00:00Z'), sourceSlug: 'unknown-source' }),
      candidate({ id: 2, publishedAt: new Date('2026-06-15T00:00:00Z'), sourceSlug: 'unknown-source' }),
      candidate({ id: 3, publishedAt: new Date('2026-06-10T00:00:00Z'), sourceSlug: 'unknown-source' }),
    ]
    expect(rankAndSelect(cands, ctx).map(c => c.id)).toEqual([2, 3, 1])
  })
  it('should free a slot for a distinct story by collapsing near-duplicate items', () => {
    // 事件 A：3 筆近重複（實體 {fed, rate-cut} 高互重疊、今天、高 base-score）
    const a1 = candidate({ id: 1, title: 'Fed 宣布降息', category: 'macro', publishedAt: new Date('2026-06-15T00:00:00Z') })
    const a2 = candidate({ id: 2, title: 'Fed 降息 市場反應', category: 'macro', publishedAt: new Date('2026-06-15T00:00:00Z') })
    const a3 = candidate({ id: 3, title: 'Fed 降息 分析', category: 'macro', publishedAt: new Date('2026-06-15T00:00:00Z') })
    // 事件 B：distinct（實體 {tsmc}、較舊、低 base-score）→ 去重前被 A 三筆擠出 top-2
    const b = candidate({ id: 4, title: 'TSMC 法說會', category: 'macro', publishedAt: new Date('2026-06-10T00:00:00Z') })
    const out = rankAndSelect([a1, a2, a3, b], ctx, { topK: 2, floorPerCategory: 0 })
    expect(out.map(c => c.id)).toContain(4)
    expect(out).toHaveLength(2)
  })
  it('should collapse same-event items by topic_tags and free a slot for a distinct story', () => {
    const a1 = candidate({ id: 1, title: '輝達發債 200 億', category: 'macro', publishedAt: new Date('2026-06-15T00:00:00Z'), topicTags: ['nvidia', 'bond-issuance'] })
    const a2 = candidate({ id: 2, title: '輝達首度發債吸金', category: 'macro', publishedAt: new Date('2026-06-15T00:00:00Z'), topicTags: ['nvidia', 'bond-issuance'] })
    const b = candidate({ id: 3, title: 'SpaceX 掛牌', category: 'macro', publishedAt: new Date('2026-06-10T00:00:00Z'), topicTags: ['spacex', 'ipo'] })
    const out = rankAndSelect([a1, a2, b], ctx, { topK: 2, floorPerCategory: 0 })
    expect(out.map(c => c.id)).toContain(3)
    expect(out).toHaveLength(2)
  })
  it('should fall back to alias entities for clustering when topic_tags are empty', () => {
    const a1 = candidate({ id: 1, title: 'Fed 降息', category: 'macro', publishedAt: new Date('2026-06-15T00:00:00Z'), topicTags: [] })
    const a2 = candidate({ id: 2, title: 'Fed 降息 分析', category: 'macro', publishedAt: new Date('2026-06-15T00:00:00Z'), topicTags: [] })
    const b = candidate({ id: 3, title: 'TSMC 法說', category: 'macro', publishedAt: new Date('2026-06-10T00:00:00Z'), topicTags: [] })
    const out = rankAndSelect([a1, a2, b], ctx, { topK: 2, floorPerCategory: 0 })
    expect(out.map(c => c.id)).toContain(3)
    expect(out).toHaveLength(2)
  })
  it('should merge cross-alias near-dups by shared topic_tags where alias clustering would not', () => {
    // a1 alias={tsmc}, a2 alias={nvidia} (disjoint → alias clustering keeps them separate),
    // but identical topic_tags → topic_tags clustering merges them, freeing a slot for distinct b.
    const a1 = candidate({ id: 1, title: 'TSMC 法說會', category: 'macro', publishedAt: new Date('2026-06-15T00:00:00Z'), topicTags: ['ai-earnings', 'taiwan-tech'] })
    const a2 = candidate({ id: 2, title: '輝達 GTC 大會', category: 'macro', publishedAt: new Date('2026-06-15T00:00:00Z'), topicTags: ['ai-earnings', 'taiwan-tech'] })
    const b = candidate({ id: 3, title: 'SpaceX 掛牌', category: 'macro', publishedAt: new Date('2026-06-10T00:00:00Z'), topicTags: ['spacex', 'ipo'] })
    const out = rankAndSelect([a1, a2, b], ctx, { topK: 2, floorPerCategory: 0 })
    expect(out.map(c => c.id)).toContain(3) // b surfaces only because a1/a2 collapsed via topic_tags
    expect(out).toHaveLength(2)
  })
  it('should apply topic_tags clustering and alias fallback within the same mixed pool', () => {
    // Tagged pair: disjoint alias ({tsmc} vs {nvidia}) but shared topic_tags → merge via tags.
    const t1 = candidate({ id: 1, title: 'TSMC 法說會', category: 'macro', publishedAt: new Date('2026-06-15T00:00:00Z'), topicTags: ['ai-earnings'] })
    const t2 = candidate({ id: 2, title: '輝達 GTC 大會', category: 'macro', publishedAt: new Date('2026-06-15T00:00:00Z'), topicTags: ['ai-earnings'] })
    // Untagged pair: no topic_tags → alias fallback ({fed, rate-cut}) merges them.
    const u1 = candidate({ id: 3, title: 'Fed 降息', category: 'macro', publishedAt: new Date('2026-06-15T00:00:00Z'), topicTags: [] })
    const u2 = candidate({ id: 4, title: 'Fed 降息 分析', category: 'macro', publishedAt: new Date('2026-06-15T00:00:00Z'), topicTags: [] })
    // Distinct, older (low base) → only survives top-3 if BOTH pairs collapse.
    const d = candidate({ id: 5, title: 'SpaceX 掛牌', category: 'macro', publishedAt: new Date('2026-06-08T00:00:00Z'), topicTags: ['spacex', 'ipo'] })
    const out = rankAndSelect([t1, t2, u1, u2, d], ctx, { topK: 3, floorPerCategory: 0 })
    expect(out).toHaveLength(3)
    expect(out.map(c => c.id)).toContain(5) // d surfaces only because BOTH the tags-pair AND the alias-pair collapsed
  })
  it('should cap a dominant storyline so a distinct unassigned story surfaces', () => {
    const storylines = [storyline({ id: 2, entities: ['Fed', '降息'] })]
    const capCtx = { storylines, aliasMap, briefDate: '2026-06-15' }
    // storyline-2 洪水：3 篇 distinct-tag、皆含 {fed, rate-cut}（→ 指派 storyline 2）、今天、高分。
    const f1 = candidate({ id: 1, title: 'Fed 降息 股市大漲', category: 'macro', publishedAt: new Date('2026-06-15T00:00:00Z'), topicTags: ['fed-cut', 'equities'] })
    const f2 = candidate({ id: 2, title: 'Fed 降息 債市反應', category: 'macro', publishedAt: new Date('2026-06-15T00:00:00Z'), topicTags: ['fed-cut', 'bonds'] })
    const f3 = candidate({ id: 3, title: 'Fed 降息 美元走弱', category: 'macro', publishedAt: new Date('2026-06-15T00:00:00Z'), topicTags: ['fed-cut', 'dollar'] })
    // 冷門 distinct：無 storyline 實體 → unassigned → 不 cap。較舊、低分。
    const cold = candidate({ id: 9, title: 'SpaceX 掛牌', category: 'macro', publishedAt: new Date('2026-06-14T00:00:00Z'), topicTags: ['spacex', 'ipo'] })
    const out = rankAndSelect([f1, f2, f3, cold], capCtx, { topK: 3, floorPerCategory: 0, capPerStoryline: 2 })
    expect(out.map(c => c.id)).toEqual([1, 2, 9]) // f3(id3) 被 cap 擠出、cold(id9) 浮上
  })
  it('should not cap when no storylines are open (default path unchanged)', () => {
    const cands = Array.from({ length: 6 }, (_, i) =>
      candidate({ id: i + 1, category: 'macro', publishedAt: new Date('2026-06-15T00:00:00Z'), sourceSlug: 'unknown-source', topicTags: [`t${i}`] }))
    // storylines: [] → 全 unassigned → cap 不觸發、行為同現況（6 筆全進、score 同分 id 升序）
    const out = rankAndSelect(cands, ctx, { topK: 6, floorPerCategory: 0 })
    expect(out.map(c => c.id)).toEqual([1, 2, 3, 4, 5, 6])
  })
})

describe('selectTopK', () => {
  const sc = (id: number, score: number, category: RelevanceCandidate['category'] = 'macro') =>
    ({ candidate: candidate({ id, category }), score })

  it('should cap total output at topK', () => {
    const scored = Array.from({ length: 50 }, (_, i) => sc(i + 1, 50 - i))
    expect(selectTopK(scored, { topK: 36, floorPerCategory: 4 })).toHaveLength(36)
  })
  it('should output candidates in descending score order', () => {
    const out = selectTopK([sc(1, 0.5), sc(2, 0.9), sc(3, 0.7)], { topK: 36, floorPerCategory: 0 })
    expect(out.map(c => c.id)).toEqual([2, 3, 1])
  })
  it('should guarantee a per-category floor for a low-score category', () => {
    const macro = Array.from({ length: 30 }, (_, i) => sc(i + 1, 10 - i * 0.1, 'macro'))
    const tw = sc(999, 0.01, 'tw-equity-other')
    const out = selectTopK([...macro, tw], { topK: 10, floorPerCategory: 2 })
    expect(out.map(c => c.id)).toContain(999)
  })
})

describe('selectTopK storyline cap', () => {
  const sc = (id: number, score: number, storylineId: number | null = null) =>
    ({ candidate: candidate({ id }), score, storylineId })

  it('should cap a dominant storyline and free slots for other items', () => {
    const flood = [sc(1, 9, 2), sc(2, 8, 2), sc(3, 7, 2)] // storyline 2 ×3
    const cold = [sc(10, 1, null), sc(11, 0.9, null)] // unassigned distinct
    const out = selectTopK([...flood, ...cold], { topK: 4, floorPerCategory: 0, capPerStoryline: 2 })
    expect(out.map(c => c.id)).toEqual([1, 2, 10, 11]) // id 3 capped out
  })
  it('should never cap unassigned (storylineId null) items', () => {
    const scored = [sc(1, 9, null), sc(2, 8, null), sc(3, 7, null), sc(4, 6, null)]
    const out = selectTopK(scored, { topK: 4, floorPerCategory: 0, capPerStoryline: 2 })
    expect(out).toHaveLength(4)
  })
  it('should relax the cap to backfill up to topK when the pool is storyline-exhausted', () => {
    const scored = [sc(1, 9, 2), sc(2, 8, 2), sc(3, 7, 2), sc(4, 6, 2)] // all storyline 2
    const out = selectTopK(scored, { topK: 3, floorPerCategory: 0, capPerStoryline: 2 })
    expect(out.map(c => c.id)).toEqual([1, 2, 3]) // cap=2 but backfill fills the 3rd
  })
  it('should behave identically to no-cap when capPerStoryline is undefined', () => {
    const scored = [sc(1, 9, 2), sc(2, 8, 2), sc(3, 7, 2)]
    const out = selectTopK(scored, { topK: 3, floorPerCategory: 0 })
    expect(out.map(c => c.id)).toEqual([1, 2, 3])
  })
  it('should let the cap override an unreachable category floor (topK still met)', () => {
    // macro 全是 storyline 2（cap 2 擋掉 id3/id4）、floor 3 在 cap 下湊不滿 → macro 只進 2 筆；
    // topK 仍由其他類（energy）補滿。記錄「cap 優先於 floor、floor 在 cap 下為 best-effort」的刻意取捨。
    const items = [
      { candidate: candidate({ id: 1, category: 'macro' }), score: 9, storylineId: 2 },
      { candidate: candidate({ id: 2, category: 'macro' }), score: 8, storylineId: 2 },
      { candidate: candidate({ id: 3, category: 'macro' }), score: 7, storylineId: 2 },
      { candidate: candidate({ id: 4, category: 'macro' }), score: 6, storylineId: 2 },
      { candidate: candidate({ id: 5, category: 'energy' }), score: 5.5, storylineId: null },
      { candidate: candidate({ id: 6, category: 'energy' }), score: 5.4, storylineId: null },
    ]
    const out = selectTopK(items, { topK: 4, floorPerCategory: 3, capPerStoryline: 2 })
    expect(out.map(c => c.id)).toEqual([1, 2, 5, 6]) // macro floor 3 不可達（id3/4 被 cap）、topK 仍滿
  })
})

describe('assignStoryline', () => {
  const sets = [
    { id: 2, entities: new Set(['oil', 'iran', 'hormuz']) },
    { id: 3, entities: new Set(['fed', 'rate-cut']) },
  ]
  it('should assign to the storyline with the most entity overlap', () => {
    expect(assignStoryline(['fed', 'rate-cut', 'oil'], sets)).toBe(3) // overlap 2 vs 1
  })
  it('should assign on a single shared entity (threshold ≥1)', () => {
    expect(assignStoryline(['oil'], sets)).toBe(2)
  })
  it('should return null when no storyline shares an entity', () => {
    expect(assignStoryline(['spacex', 'ipo'], sets)).toBeNull()
  })
  it('should break overlap ties by lowest storyline id', () => {
    const tie = [
      { id: 5, entities: new Set(['x']) },
      { id: 3, entities: new Set(['x']) },
    ]
    expect(assignStoryline(['x'], tie)).toBe(3)
  })
  it('should return null for empty perStorylineSets', () => {
    expect(assignStoryline(['oil'], [])).toBeNull()
  })
  it('should return null for empty entities', () => {
    expect(assignStoryline([], sets)).toBeNull()
  })
})

describe('jaccard', () => {
  it('should return 1 for identical sets', () => {
    expect(jaccard(new Set(['a', 'b']), new Set(['a', 'b']))).toBe(1)
  })
  it('should return 0 for disjoint sets', () => {
    expect(jaccard(new Set(['a']), new Set(['b']))).toBe(0)
  })
  it('should compute intersection over union', () => {
    expect(jaccard(new Set(['a', 'b', 'c']), new Set(['b', 'c', 'd']))).toBeCloseTo(2 / 4, 5)
  })
  it('should return 0 when both sets are empty', () => {
    expect(jaccard(new Set<string>(), new Set<string>())).toBe(0)
  })
  it('should handle a subset (half overlap)', () => {
    expect(jaccard(new Set(['a']), new Set(['a', 'b']))).toBeCloseTo(1 / 2, 5)
  })
})

describe('dedupeByStory', () => {
  const briefDate = '2026-06-15'
  function depItem(id: number, entities: string[], partial: Partial<RelevanceCandidate> = {}) {
    return { candidate: candidate({ id, ...partial }), clusterEntities: entities, entities }
  }
  it('should collapse two high-overlap items into one', () => {
    const out = dedupeByStory([depItem(1, ['fed', 'rate-cut']), depItem(2, ['fed', 'rate-cut'])], briefDate, 0.5)
    expect(out).toHaveLength(1)
  })
  it('should keep the higher base-score (more recent) representative', () => {
    const out = dedupeByStory([
      depItem(2, ['fed', 'rate-cut'], { publishedAt: new Date('2026-06-10T00:00:00Z') }),
      depItem(1, ['fed', 'rate-cut'], { publishedAt: new Date('2026-06-15T00:00:00Z') }),
    ], briefDate, 0.5)
    expect(out).toHaveLength(1)
    expect(out[0]?.candidate.id).toBe(1)
  })
  it('should keep both items when overlap is below threshold', () => {
    const out = dedupeByStory([depItem(1, ['fed']), depItem(2, ['tsmc'])], briefDate, 0.5)
    expect(out).toHaveLength(2)
  })
  it('should collapse three same-event items into one', () => {
    const out = dedupeByStory([depItem(1, ['fed', 'rate-cut']), depItem(2, ['fed', 'rate-cut']), depItem(3, ['fed', 'rate-cut'])], briefDate, 0.5)
    expect(out).toHaveLength(1)
  })
  it('should never merge two empty-entity items', () => {
    const out = dedupeByStory([depItem(1, []), depItem(2, [])], briefDate, 0.5)
    expect(out).toHaveLength(2)
  })
  it('should never merge an empty-entity item with an entity-bearing item', () => {
    const out = dedupeByStory([depItem(1, []), depItem(2, ['fed'])], briefDate, 0.5)
    expect(out).toHaveLength(2)
  })
  it('should merge exactly at the threshold boundary', () => {
    const out = dedupeByStory([depItem(1, ['a', 'b', 'c']), depItem(2, ['a', 'b', 'c', 'd'])], briefDate, 0.75)
    expect(out).toHaveLength(1)
  })
  it('should break base-score ties by lower id', () => {
    const out = dedupeByStory([depItem(3, ['fed', 'rate-cut']), depItem(1, ['fed', 'rate-cut'])], briefDate, 0.5)
    expect(out).toHaveLength(1)
    expect(out[0]?.candidate.id).toBe(1)
  })
  it('should cluster by clusterEntities but pass through entities', () => {
    const out = dedupeByStory([
      { candidate: candidate({ id: 1, publishedAt: new Date('2026-06-10T00:00:00Z') }), clusterEntities: ['x'], entities: ['alias-old'] },
      { candidate: candidate({ id: 2, publishedAt: new Date('2026-06-15T00:00:00Z') }), clusterEntities: ['x'], entities: ['alias-new'] },
    ], briefDate, 0.5)
    expect(out).toHaveLength(1)
    expect(out[0]?.candidate.id).toBe(2)
    expect(out[0]?.entities).toEqual(['alias-new'])
  })
  it('should not merge when clusterEntities differ even if entities overlap', () => {
    const out = dedupeByStory([
      { candidate: candidate({ id: 1 }), clusterEntities: ['x'], entities: ['same'] },
      { candidate: candidate({ id: 2 }), clusterEntities: ['y'], entities: ['same'] },
    ], briefDate, 0.5)
    expect(out).toHaveLength(2)
  })
})
