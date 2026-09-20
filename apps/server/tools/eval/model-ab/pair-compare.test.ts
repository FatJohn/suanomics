import type { ArticleRun, EntityOut, RunFile } from './types.js'
import { describe, expect, it } from 'vitest'
import { comparePair, consistentDivergences } from './pair-compare.js'

const ent = (name: string, kind = 'company'): EntityOut => ({ name, kind, confidence: 0.9 })

function article(articleId: number, entities: EntityOut[], topicTags: string[] = []): ArticleRun {
  return {
    articleId,
    title: `文章 ${articleId}`,
    failed: false,
    contentSummary: '',
    entities,
    rawKinds: entities.map(e => e.kind),
    topicTags,
    attempts: 1,
    zodFailures: 0,
    llmErrors: 0,
    tokensIn: 0,
    tokensOut: 0,
    cachedReadTokens: 0,
    costUsd: 0,
    latencyMs: 0,
  }
}

function run(label: string, articles: ArticleRun[]): RunFile {
  return {
    label,
    agent: 'corpus-entity-summary',
    configuredModel: 'm',
    resolvedModel: 'm',
    startedAt: '2026-08-02T00:00:00.000Z',
    articles,
  }
}

describe('comparePair：兩個 run 檔的逐篇比對', () => {
  it('strict 不折別名、lenient 折（同一組實體兩種寫法不該算成分歧）', () => {
    const a = run('A1', [article(1, [ent('台積電(2330)'), ent('輝達')])])
    const b = run('B1', [article(1, [ent('TSMC'), ent('NVIDIA')])])
    const c = comparePair(a, b)
    expect(c.entityJaccardStrict).toBe(0)
    expect(c.entityJaccardLenient).toBe(1)
  })

  it('kind 一致率只看兩臂都抽到的實體', () => {
    const a = run('A1', [article(1, [ent('台積電', 'company'), ent('關稅', 'macro')])])
    const b = run('B1', [article(1, [ent('TSMC', 'ticker'), ent('關稅', 'macro'), ent('Helios', 'company')])])
    const c = comparePair(a, b)
    expect(c.kindAgreement).toBeCloseTo(0.5, 10)
    expect(c.perArticle[0]?.kindDiff).toEqual(['tsmc: company→ticker'])
  })

  it('perArticle 依 jaccard 由小到大排（分歧最大的排前面、給質性抽查用）', () => {
    const a = run('A1', [article(1, [ent('x')]), article(2, [ent('y'), ent('z')])])
    const b = run('B1', [article(1, [ent('w')]), article(2, [ent('y'), ent('z')])])
    const c = comparePair(a, b)
    expect(c.perArticle.map(p => p.articleId)).toEqual([1, 2])
    expect(c.perArticle[0]?.missed).toEqual(['x[company]'])
    expect(c.perArticle[0]?.extra).toEqual(['w[company]'])
  })

  it('任一邊 failed 的文章整篇跳過（不當成 0 重疊拉低分母）', () => {
    const failed = { ...article(2, []), failed: true }
    const a = run('A1', [article(1, [ent('x')]), failed])
    const b = run('B1', [article(1, [ent('x')]), article(2, [ent('y')])])
    const c = comparePair(a, b)
    expect(c.perArticle).toHaveLength(1)
    expect(c.entityJaccardLenient).toBe(1)
  })

  it('只有 tag 的 agent（news-tagger 無 entities）改用 tag 算分歧', () => {
    const a = run('A1', [article(1, [], ['fed-rate', 'AI_chips'])])
    const b = run('B1', [article(1, [], ['fed rate'])])
    const c = comparePair(a, b)
    expect(c.tagJaccard).toBeCloseTo(0.5, 10)
    expect(c.perArticle[0]?.jaccard).toBeCloseTo(0.5, 10)
    expect(c.perArticle[0]?.missed).toEqual(['AI_chips[tag]'])
  })
})

describe('consistentDivergences：只留「兩跑都一致」的分歧', () => {
  // 這是 2026-08-02 實驗二把結論從「flash 勝 10」翻成「11:11 打平」的那個動作。
  // 單跑分歧裡混著模型自身的抖動，拿去讀原文判對錯會判出反方向的結論。
  const A1 = run('A1', [article(1, [ent('Helios'), ent('台積電'), ent('KOSPI')])])
  const A2 = run('A2', [article(1, [ent('Helios'), ent('TSMC')])])
  const B1 = run('B1', [article(1, [ent('台積電(2330)'), ent('Alphabet')])])
  const B2 = run('B2', [article(1, [ent('台積電'), ent('Alphabet')])])

  it('兩跑都有、對臂兩跑都沒有 → 才算 A 臂獨有', () => {
    const d = consistentDivergences([A1, A2], [B1, B2])
    expect(d).toHaveLength(1)
    expect(d[0]?.aOnly).toEqual(['Helios'])
  })

  it('只在 A 臂其中一跑出現的實體不算分歧（那是抖動、不是 model 差異）', () => {
    const d = consistentDivergences([A1, A2], [B1, B2])
    expect(d[0]?.aOnly).not.toContain('KOSPI')
  })

  it('對臂兩跑都有的實體算 B 臂獨有', () => {
    const d = consistentDivergences([A1, A2], [B1, B2])
    expect(d[0]?.bOnly).toEqual(['Alphabet'])
  })

  it('別名折疊後兩臂都有的實體不算分歧（台積電 vs TSMC vs 台積電(2330)）', () => {
    const d = consistentDivergences([A1, A2], [B1, B2])
    expect(d[0]?.aOnly).not.toContain('台積電')
    expect(d[0]?.bOnly).not.toContain('台積電(2330)')
  })

  it('沒有一致分歧的文章不列進來', () => {
    const same = [run('A1', [article(9, [ent('x')])]), run('A2', [article(9, [ent('x')])])]
    const alsoSame = [run('B1', [article(9, [ent('x')])]), run('B2', [article(9, [ent('x')])])]
    expect(consistentDivergences(same, alsoSame)).toEqual([])
  })

  it('任一臂只有一跑時直接丟錯（這個函式的前提就是同臂雙跑）', () => {
    expect(() => consistentDivergences([A1], [B1, B2])).toThrow()
  })

  it('可改看 topicTags（news-tagger 那條路徑沒有 entities）', () => {
    const tagged = (label: string, tags: string[]): RunFile => run(label, [article(1, [], tags)])
    const d = consistentDivergences(
      [tagged('A1', ['fed-rate', 'chips']), tagged('A2', ['Fed_Rate', 'chips'])],
      [tagged('B1', ['chips']), tagged('B2', ['chips'])],
      'topicTags',
    )
    expect(d[0]?.aOnly).toEqual(['fed-rate'])
    expect(d[0]?.bOnly).toEqual([])
  })

  it('分歧多的文章排前面', () => {
    const many = (label: string, names: string[]): RunFile =>
      run(label, [article(1, [ent('x')]), article(2, names.map(n => ent(n)))])
    const d = consistentDivergences(
      [many('A1', ['p', 'q', 'r']), many('A2', ['p', 'q', 'r'])],
      [many('B1', []), many('B2', [])],
    )
    expect(d.map(x => x.articleId)).toEqual([2])
    expect(d[0]?.aOnly).toEqual(['p', 'q', 'r'])
  })
})
