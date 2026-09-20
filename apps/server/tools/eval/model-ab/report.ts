import type { AgreementPair } from './arms.js'
import type { DivergenceField, PairSummary } from './pair-compare.js'
import type { RunFile } from './types.js'
import { summarizeArm } from './arm-summary.js'
import { armsWithoutBaseline, assessSignal, labelPairs, parseLabel } from './arms.js'
import { pct } from './metrics.js'
import { comparePair, consistentDivergences } from './pair-compare.js'

// 報表渲染。唯一的硬規則：**同臂雜訊底線與跨臂差異一定同時出現**，
// 而且缺同臂對照組時不准印可下結論的判定（見 eval/model-ab/arms.ts 檔頭）。

const RULE = '='.repeat(78)

function armRows(runs: readonly RunFile[]): string[] {
  // entity 與 summary 欄只對 entity-summary 那條路徑有意義；news-tagger / prose 模式
  // 印出來只會是一排 0，反而讓人誤以為「抽不到東西」。
  const hasEntities = runs.some(r => r.articles.some(a => a.entities.length > 0))
  const hasArticles = runs.some(r => r.articles.length > 0)
  const lines = ['-- 每臂彙總（impliedPrice 由 (tokensIn, tokensOut, costUsd) 最小平方反推、$/1M）--']
  for (const r of runs) {
    const s = summarizeArm(r)
    lines.push(
      `[${s.label}] model=${s.resolvedModel}`,
      `  impliedPrice in=${s.impliedInputPrice?.toFixed(3) ?? 'n/a'} out=${s.impliedOutputPrice?.toFixed(3) ?? 'n/a'}`,
    )
    if (hasArticles)
      lines.push(`  failed=${s.failed}/${s.n} zodFail=${s.zodFailures} llmErr=${s.llmErrors} retried=${s.retriedArticles}`)
    if (hasEntities) {
      lines.push(
        `  entities/篇 mean=${s.entitiesPerArticle.toFixed(2)} median=${s.entitiesMedian} otherRatio=${pct(s.otherRatio)} invalidKind=${s.invalidKindCount}`,
        `  summary字數 mean=${s.summaryLenMean.toFixed(1)} [${s.summaryLenMin},${s.summaryLenMax}] 出界80-120=${s.summaryOutOfRange}`,
      )
    }
    if (hasArticles)
      lines.push(`  tags/篇 mean=${s.tagsPerArticle.toFixed(2)}`)
    lines.push(`  tokens in=${s.tokensIn} out=${s.tokensOut}  cost=$${s.costUsd.toFixed(5)}  latency mean=${(s.latencyMeanMs / 1000).toFixed(1)}s p95=${(s.latencyP95Ms / 1000).toFixed(1)}s`)
  }
  return lines
}

function agreementOf(c: PairSummary, field: DivergenceField): number {
  return field === 'topicTags' ? c.tagJaccard : c.entityJaccardLenient
}

function pairRows(runs: readonly RunFile[], field: DivergenceField): { lines: string[], pairs: AgreementPair[] } {
  const byLabel = new Map(runs.map(r => [r.label, r]))
  const tagMode = field === 'topicTags'
  const lines = [
    '-- 兩兩比對（同臂＝該 model 自己跟自己、就是雜訊底線；跨臂數字要跟它比才有意義）--',
    tagMode
      ? '類型   ref→cand      | tagJacc | tagRecall'
      : '類型   ref→cand      | entJacc(strict) | entJacc(alias) | recall(alias) | prec(alias) | kind一致 | tagJacc',
  ]
  const pairs: AgreementPair[] = []
  for (const p of labelPairs(runs.map(r => r.label))) {
    const a = byLabel.get(p.ref)
    const b = byLabel.get(p.cand)
    if (!a || !b)
      continue
    const c = comparePair(a, b)
    pairs.push({ ...p, agreement: agreementOf(c, field) })
    const head = `${(p.kind === 'within' ? '同臂' : '跨臂').padEnd(5)}${`${c.ref}→${c.cand}`.padEnd(13)}`
    lines.push(tagMode
      ? `${head} | ${pct(c.tagJaccard).padStart(7)} | ${pct(c.tagRecall).padStart(9)}`
      : `${head} | ${pct(c.entityJaccardStrict).padStart(15)} | ${pct(c.entityJaccardLenient).padStart(14)} | ${pct(c.entityRecallLenient).padStart(13)} | ${pct(c.entityPrecisionLenient).padStart(11)} | ${pct(c.kindAgreement).padStart(8)} | ${pct(c.tagJaccard).padStart(7)}`)
  }
  return { lines, pairs }
}

const VERDICT_LABEL = {
  'no-baseline': '不可判讀（缺同臂對照組）',
  'unstable-baseline': '不可判讀（同臂雜訊過大）',
  'within-noise': '跨臂差異落在雜訊內',
  'exceeds-noise': '跨臂差異超出雜訊',
} as const

function verdictRows(pairs: readonly AgreementPair[], field: DivergenceField): string[] {
  const a = assessSignal(pairs)
  const metric = field === 'topicTags' ? 'tag Jaccard' : 'entity Jaccard (alias)'
  const lines = [
    `-- 判定（尺＝${metric}）--`,
    `同臂雜訊底線：${a.withinArm.map(w => `${w.arm} ${pct(w.agreement)}`).join('  ') || '(無)'}`,
    `跨臂平均：${a.crossArmMean === null ? '(無)' : pct(a.crossArmMean)}`,
    `>>> ${VERDICT_LABEL[a.verdict]}：${a.reason}`,
  ]
  if (a.verdict === 'no-baseline')
    lines.push('!!! 缺同臂雙跑對照組時，跨臂數字分不出「model 差異」與「模型自身抖動」。重跑時不要指定 --replicates=1。')
  if (a.verdict === 'exceeds-noise')
    lines.push('注意：重疊率只量一致性、不判對錯（兩臂都抽錯同一個實體、重疊率照樣 100%）。下一步必須讀原文做質性抽查。')
  return lines
}

function divergenceRows(runs: readonly RunFile[], field: DivergenceField, topN: number): string[] {
  const armA = runs.filter(r => parseLabel(r.label).arm === 'A')
  const armB = runs.filter(r => parseLabel(r.label).arm === 'B')
  if (armA.length >= 2 && armB.length >= 2) {
    const d = consistentDivergences(armA, armB, field).slice(0, topN)
    const lines = [`-- 一致分歧 top ${topN}（A 兩跑都有 / B 兩跑都有；已濾掉單跑才出現的抖動）--`]
    if (!d.length)
      lines.push('（無：兩臂在所有文章上的穩定抽取結果相同）')
    for (const x of d) {
      lines.push(`\n#${x.articleId} ${x.title}`)
      lines.push(`  只有 A 臂穩定抽到: ${x.aOnly.join(', ') || '(無)'}`)
      lines.push(`  只有 B 臂穩定抽到: ${x.bOnly.join(', ') || '(無)'}`)
    }
    return lines
  }
  const a = armA[0]
  const b = armB[0]
  if (!a || !b)
    return []
  const c = comparePair(a, b)
  const lines = [
    `-- 單跑分歧 top ${topN}（${c.ref} vs ${c.cand}）--`,
    '!!! 這份清單混著模型自身的抖動，不可據此判「哪個 model 比較好」——那正是 2026-08-02 判錯方向的原因。',
  ]
  for (const p of c.perArticle.slice(0, topN)) {
    lines.push(`\n#${p.articleId} jacc=${pct(p.jaccard)} ${p.title}`)
    lines.push(`  ${c.ref} 有而 ${c.cand} 無: ${p.missed.join(', ') || '(無)'}`)
    lines.push(`  ${c.cand} 有而 ${c.ref} 無: ${p.extra.join(', ') || '(無)'}`)
  }
  return lines
}

export function renderStructuredReport(o: {
  agentName: string
  runs: readonly RunFile[]
  divergenceField: DivergenceField
  divergeN: number
}): string[] {
  const { lines: pl, pairs } = pairRows(o.runs, o.divergenceField)
  const n = o.runs[0]?.articles.length ?? 0
  return [
    RULE,
    `受測 agent: ${o.agentName}   樣本 ${n} 篇   臂 ${o.runs.map(r => r.label).join(',')}`,
    RULE,
    '',
    ...armRows(o.runs),
    '',
    ...pl,
    '',
    ...verdictRows(pairs, o.divergenceField),
    '',
    ...divergenceRows(o.runs, o.divergenceField, o.divergeN),
  ]
}

/**
 * prose 模式沒有機械指標，judge 的雜訊底線只能靠「同一個 model 兩跑互相對打」量出來。
 * 所以這條路徑走**跟 structured 完全同一道閘門**（`armsWithoutBaseline`）：缺同臂
 * 對照組時一條 `brief:quality` 指令都不印——包括跨臂那條。
 *
 * 為什麼不只是加警告：viewpoints-debate 那次實驗正是 prose 型，而 2026-08-02 的教訓
 * 是「單跑資料會得到相反結論」。只要跨臂指令還在畫面上可以複製貼上，使用者就會拿到
 * 一份看起來能下結論的 judge 輸出，警告文字擋不住。
 */
export function renderProseReport(o: { agentName: string, runs: readonly RunFile[] }): string[] {
  const head = [
    RULE,
    `受測 agent: ${o.agentName}（prose 模式：無結構化輸出、機械指標量不到，只能交 pairwise judge）`,
    RULE,
    '',
    ...armRows(o.runs),
    '',
  ]
  const bare = armsWithoutBaseline(o.runs.map(r => r.label))
  if (bare.length || !o.runs.length) {
    return [
      ...head,
      '-- 判定 --',
      `>>> ${VERDICT_LABEL['no-baseline']}：臂 ${bare.join('/') || '(無)'} 只跑了一次、量不到 judge 自己的雜訊`,
      '!!! judge 在小差異上會被位置偏誤主導（12/12 全 tie 卻 swap 後全數抵銷＝無訊號、不是勢均力敵）。',
      '!!! 沒有同臂雙跑就分不出「model 差異」與「judge 位置偏誤」，因此本工具不輸出任何 brief:quality 指令。',
      '重跑時不要指定 --replicates=1；產物路徑仍記在各 run 檔的 artifacts 欄。',
    ]
  }
  const armA = o.runs.filter(r => parseLabel(r.label).arm === 'A')
  const armB = o.runs.filter(r => parseLabel(r.label).arm === 'B')
  const judge = (x: RunFile | undefined, y: RunFile | undefined): string =>
    x?.artifacts?.[0] && y?.artifacts?.[0]
      ? `pnpm brief:quality -a ${x.artifacts[0]} -b ${y.artifacts[0]} --labelA ${x.label} --labelB ${y.label} --date <YYYY-MM-DD>`
      : '(缺產物)'
  return [
    ...head,
    '-- 下一步：judge 的雜訊底線要先跑 --',
    '1) 同臂雙跑對打（這一組的勝負就是 judge 自己的雜訊；全 tie 且 swap 後抵銷＝無訊號、不是勢均力敵）：',
    `   ${judge(armA[0], armA[1])}`,
    `   ${judge(armB[0], armB[1])}`,
    '2) 跨臂對打（只有勝負幅度明顯超出上面那組才算訊號）：',
    `   ${judge(armA[0], armB[0])}`,
    '',
    '每個日期各有一份 brief，逐日重複上面兩步。',
  ]
}
