import type { ArticleRun, CallRow, RunFile } from './types.js'
import { describe, expect, it } from 'vitest'
import { summarizeArm } from './arm-summary.js'

function article(over: Partial<ArticleRun> = {}): ArticleRun {
  return {
    articleId: 1,
    title: 't',
    failed: false,
    contentSummary: 'x'.repeat(100),
    entities: [],
    rawKinds: [],
    topicTags: [],
    attempts: 1,
    zodFailures: 0,
    llmErrors: 0,
    tokensIn: 0,
    tokensOut: 0,
    cachedReadTokens: 0,
    costUsd: 0,
    latencyMs: 0,
    ...over,
  }
}

function run(articles: ArticleRun[], calls?: CallRow[]): RunFile {
  return {
    label: 'A1',
    agent: 'corpus-entity-summary',
    configuredModel: 'gemini-3.5-flash',
    resolvedModel: 'gemini-3.5-flash',
    startedAt: '2026-08-02T00:00:00.000Z',
    articles,
    ...(calls ? { calls } : {}),
  }
}

function ent(name: string, kind = 'company'): { name: string, kind: string, confidence: number } {
  return { name, kind, confidence: 0.9 }
}

describe('summarizeArm：單臂彙總', () => {
  it('label 拆出 arm 與第幾跑', () => {
    const s = summarizeArm(run([article()]))
    expect(s.arm).toBe('A')
    expect(s.replicate).toBe(1)
  })

  it('entities/篇只算沒失敗的文章、失敗的另外計數', () => {
    const s = summarizeArm(run([
      article({ articleId: 1, entities: [ent('a'), ent('b'), ent('c')] }),
      article({ articleId: 2, entities: [ent('a')] }),
      article({ articleId: 3, failed: true, entities: [] }),
    ]))
    expect(s.n).toBe(3)
    expect(s.failed).toBe(1)
    expect(s.entitiesPerArticle).toBe(2)
    expect(s.entitiesMedian).toBe(3)
  })

  it('otherRatio 看收斂後的 kind、invalidKind 看 LLM 原始吐出的 kind', () => {
    const s = summarizeArm(run([
      article({
        entities: [ent('a', 'other'), ent('b', 'company'), ent('c', 'macro'), ent('d', 'other')],
        rawKinds: ['person', 'company', 'macro', 'other'],
      }),
    ]))
    expect(s.otherRatio).toBeCloseTo(0.5, 10)
    expect(s.invalidKindCount).toBe(1)
  })

  it('summary 字數用字元數（中文一個字算一個）、80–120 之外算出界', () => {
    const s = summarizeArm(run([
      article({ articleId: 1, contentSummary: '中'.repeat(90) }),
      article({ articleId: 2, contentSummary: '中'.repeat(213) }),
      article({ articleId: 3, contentSummary: '中'.repeat(40) }),
    ]))
    expect(s.summaryLenMin).toBe(40)
    expect(s.summaryLenMax).toBe(213)
    expect(s.summaryOutOfRange).toBe(2)
  })

  it('記帳優先吃 calls（batch 型 agent 的呼叫層帳）', () => {
    const s = summarizeArm(run(
      [article({ tokensIn: 999, tokensOut: 999, costUsd: 9 })],
      [
        { tokensIn: 100, tokensOut: 10, cachedReadTokens: 0, costUsd: 0.001, latencyMs: 1000, attempts: 1 },
        { tokensIn: 200, tokensOut: 20, cachedReadTokens: 0, costUsd: 0.002, latencyMs: 3000, attempts: 1 },
      ],
    ))
    expect(s.tokensIn).toBe(300)
    expect(s.tokensOut).toBe(30)
    expect(s.costUsd).toBeCloseTo(0.003, 10)
    expect(s.latencyMeanMs).toBe(2000)
  })

  it('沒有 calls 時退回 articles 的逐篇欄位', () => {
    const s = summarizeArm(run([
      article({ articleId: 1, tokensIn: 100, tokensOut: 10, costUsd: 0.001, latencyMs: 1000 }),
      article({ articleId: 2, tokensIn: 200, tokensOut: 20, costUsd: 0.002, latencyMs: 3000 }),
    ]))
    expect(s.tokensIn).toBe(300)
    expect(s.latencyMeanMs).toBe(2000)
  })

  it('反推出的單價就是 llm-wrapper 當下實際採用的定價（model 有沒有生效的硬證據）', () => {
    const rows = [
      { tokensIn: 10_000, tokensOut: 500 },
      { tokensIn: 4_000, tokensOut: 1_200 },
      { tokensIn: 25_000, tokensOut: 300 },
    ]
    const calls: CallRow[] = rows.map(r => ({
      ...r,
      cachedReadTokens: 0,
      costUsd: (r.tokensIn * 0.3 + r.tokensOut * 2.5) / 1_000_000,
      latencyMs: 1000,
      attempts: 1,
    }))
    const s = summarizeArm(run([article()], calls))
    expect(s.impliedInputPrice).toBeCloseTo(0.3, 6)
    expect(s.impliedOutputPrice).toBeCloseTo(2.5, 6)
  })

  it('retry / zod 失敗 / llm 錯誤逐篇加總（含失敗的文章）', () => {
    const s = summarizeArm(run([
      article({ articleId: 1, attempts: 2, zodFailures: 1 }),
      article({ articleId: 2, attempts: 1, llmErrors: 1, failed: true }),
    ]))
    expect(s.retriedArticles).toBe(1)
    expect(s.zodFailures).toBe(1)
    expect(s.llmErrors).toBe(1)
  })
})
