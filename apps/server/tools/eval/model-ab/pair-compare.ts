import type { PairStat } from './metrics.js'
import type { ArticleRun, RunFile } from './types.js'
import { mean, pairStat } from './metrics.js'
import { normLenient, normStrict, normTag } from './normalize.js'

// 兩個 run 檔的比對。**同臂配對與跨臂配對走的是同一組函式**——
// 這是刻意的：雜訊底線與跨臂差異必須用同一把尺量，才能互相比較。

export interface PairSummary {
  ref: string
  cand: string
  entityRecallStrict: number
  entityPrecisionStrict: number
  entityJaccardStrict: number
  entityRecallLenient: number
  entityPrecisionLenient: number
  entityJaccardLenient: number
  tagJaccard: number
  tagRecall: number
  kindAgreement: number
  perArticle: {
    articleId: number
    title: string
    jaccard: number
    missed: string[]
    extra: string[]
    kindDiff: string[]
  }[]
}

/** 只有 tag 的 agent（news-tagger）沒有 entities、分歧改看 tag。 */
function isTagOnly(ref: ArticleRun, cand: ArticleRun): boolean {
  return ref.entities.length === 0 && cand.entities.length === 0
}

export function comparePair(refRun: RunFile, candRun: RunFile): PairSummary {
  const candById = new Map(candRun.articles.map(a => [a.articleId, a]))
  const strict: PairStat[] = []
  const lenient: PairStat[] = []
  const tagStats: PairStat[] = []
  const perArticle: PairSummary['perArticle'] = []
  let kindMatch = 0
  let kindTotal = 0

  for (const ref of refRun.articles) {
    const cand = candById.get(ref.articleId)
    if (!cand || ref.failed || cand.failed)
      continue
    strict.push(pairStat(ref.entities.map(e => normStrict(e.name)), cand.entities.map(e => normStrict(e.name))))
    const rL = ref.entities.map(e => normLenient(e.name))
    const cL = cand.entities.map(e => normLenient(e.name))
    const lp = pairStat(rL, cL)
    lenient.push(lp)
    tagStats.push(pairStat(ref.topicTags.map(normTag), cand.topicTags.map(normTag)))

    // kind 一致率：只看兩臂都抽到的實體（lenient 對齊）
    const candKind = new Map(cand.entities.map(e => [normLenient(e.name), e.kind]))
    const kindDiff: string[] = []
    for (const [name, k] of new Map(ref.entities.map(e => [normLenient(e.name), e.kind]))) {
      const ck = candKind.get(name)
      if (ck === undefined)
        continue
      kindTotal++
      if (ck === k)
        kindMatch++
      else kindDiff.push(`${name}: ${k}→${ck}`)
    }

    const tagOnly = isTagOnly(ref, cand)
    const key = (n: string): string => (tagOnly ? normTag(n) : normLenient(n))
    const refItems = tagOnly ? ref.topicTags.map(n => ({ name: n, kind: 'tag' })) : ref.entities
    const candItems = tagOnly ? cand.topicTags.map(n => ({ name: n, kind: 'tag' })) : cand.entities
    const refSet = new Set(refItems.map(e => key(e.name)))
    const candSet = new Set(candItems.map(e => key(e.name)))
    perArticle.push({
      articleId: ref.articleId,
      title: ref.title,
      jaccard: tagOnly ? pairStat([...refSet], [...candSet]).jaccard : lp.jaccard,
      missed: refItems.filter(e => !candSet.has(key(e.name))).map(e => `${e.name}[${e.kind}]`),
      extra: candItems.filter(e => !refSet.has(key(e.name))).map(e => `${e.name}[${e.kind}]`),
      kindDiff,
    })
  }

  return {
    ref: refRun.label,
    cand: candRun.label,
    entityRecallStrict: mean(strict.map(s => s.recall)),
    entityPrecisionStrict: mean(strict.map(s => s.precision)),
    entityJaccardStrict: mean(strict.map(s => s.jaccard)),
    entityRecallLenient: mean(lenient.map(s => s.recall)),
    entityPrecisionLenient: mean(lenient.map(s => s.precision)),
    entityJaccardLenient: mean(lenient.map(s => s.jaccard)),
    tagJaccard: mean(tagStats.map(s => s.jaccard)),
    tagRecall: mean(tagStats.map(s => s.recall)),
    kindAgreement: kindTotal ? kindMatch / kindTotal : 1,
    perArticle: perArticle.sort((a, b) => a.jaccard - b.jaccard),
  }
}

export type DivergenceField = 'entities' | 'topicTags'

export interface ConsistentDivergence {
  articleId: number
  title: string
  /** A 臂每一跑都抽到、B 臂每一跑都沒抽到 */
  aOnly: string[]
  bOnly: string[]
}

function namesOf(a: ArticleRun, field: DivergenceField): string[] {
  return field === 'entities' ? a.entities.map(e => e.name) : a.topicTags
}

/**
 * 只留「兩跑都一致」的分歧——這是質性抽查唯一該讀的清單。
 *
 * 單跑分歧裡混著模型自身的抖動：2026-08-02 實驗二第一輪照單跑分歧讀原文判出
 * 「flash 勝 10」，換成一致分歧重判後變成 11:11 打平。所以本函式在任一臂只有
 * 一跑時直接丟錯，而不是回一份看起來能用的清單。
 */
export function consistentDivergences(
  armARuns: readonly RunFile[],
  armBRuns: readonly RunFile[],
  field: DivergenceField = 'entities',
): ConsistentDivergence[] {
  if (armARuns.length < 2 || armBRuns.length < 2)
    throw new Error(`一致分歧需要兩臂各至少 2 跑、收到 A=${armARuns.length} B=${armBRuns.length}`)
  const key = field === 'entities' ? normLenient : normTag
  const first = armARuns[0]
  if (!first)
    return []

  const display = new Map<string, string>()
  const keysFor = (runs: readonly RunFile[], articleId: number): Set<string>[] | null => {
    const sets: Set<string>[] = []
    for (const r of runs) {
      const a = r.articles.find(x => x.articleId === articleId)
      if (!a || a.failed)
        return null
      const s = new Set<string>()
      for (const name of namesOf(a, field)) {
        const k = key(name)
        s.add(k)
        if (!display.has(k))
          display.set(k, name)
      }
      sets.push(s)
    }
    return sets
  }

  const out: ConsistentDivergence[] = []
  for (const article of first.articles) {
    const aSets = keysFor(armARuns, article.articleId)
    const bSets = keysFor(armBRuns, article.articleId)
    if (!aSets || !bSets)
      continue
    const stable = (sets: Set<string>[]): string[] =>
      [...(sets[0] ?? [])].filter(k => sets.every(s => s.has(k)))
    const union = (sets: Set<string>[]): Set<string> => new Set(sets.flatMap(s => [...s]))
    const anyA = union(aSets)
    const anyB = union(bSets)
    const aOnly = stable(aSets).filter(k => !anyB.has(k)).map(k => display.get(k) ?? k)
    const bOnly = stable(bSets).filter(k => !anyA.has(k)).map(k => display.get(k) ?? k)
    if (aOnly.length || bOnly.length)
      out.push({ articleId: article.articleId, title: article.title, aOnly, bOnly })
  }
  return out.sort((x, y) => (y.aOnly.length + y.bOnly.length) - (x.aOnly.length + x.bOnly.length))
}
