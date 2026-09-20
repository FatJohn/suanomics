import type { RunFile } from './types.js'
import { describe, expect, it } from 'vitest'
import { renderProseReport, renderStructuredReport } from './report.js'

// 這份測試守的是「使用者不能在沒有雜訊底線的情況下，不小心拿到一個看起來可以下結論的輸出」。
// structured 與 prose 兩條路徑都必須擋，而且擋的方式要對等——prose 那條光有警告文字不算，
// 只要跨臂的 brief:quality 指令還在畫面上可以複製貼上，使用者就會拿到那個結論。

function proseRun(label: string, model: string): RunFile {
  return {
    label,
    agent: 'viewpoints-debate',
    configuredModel: model,
    resolvedModel: model,
    startedAt: '2026-08-02T00:00:00.000Z',
    articles: [],
    calls: [{ tokensIn: 1000, tokensOut: 100, cachedReadTokens: 0, costUsd: 0.0024, latencyMs: 900, attempts: 1 }],
    artifacts: [`/tmp/.eval-out/2026-07-21-${label}.json`],
  }
}

function structuredRun(label: string, model: string, names: string[]): RunFile {
  return {
    label,
    agent: 'corpus-entity-summary',
    configuredModel: model,
    resolvedModel: model,
    startedAt: '2026-08-02T00:00:00.000Z',
    articles: [{
      articleId: 1,
      title: '文章',
      failed: false,
      contentSummary: '中'.repeat(100),
      entities: names.map(n => ({ name: n, kind: 'company', confidence: 0.9 })),
      rawKinds: names.map(() => 'company'),
      topicTags: [],
      attempts: 1,
      zodFailures: 0,
      llmErrors: 0,
      tokensIn: 1000,
      tokensOut: 100,
      cachedReadTokens: 0,
      costUsd: 0.0024,
      latencyMs: 900,
    }],
  }
}

const JUDGE_CMD = /pnpm brief:quality/

describe('renderProseReport：prose 路徑的閘門', () => {
  const agentName = 'viewpoints-debate'

  it('有同臂雙跑時才給指令，且同臂那組排在跨臂之前', () => {
    const runs = ['A1', 'A2'].map(l => proseRun(l, 'm-a')).concat(['B1', 'B2'].map(l => proseRun(l, 'm-b')))
    const out = renderProseReport({ agentName, runs })
    const cmds = out.filter(l => JUDGE_CMD.test(l))
    expect(cmds).toHaveLength(3)
    expect(cmds[0]).toContain('--labelA A1 --labelB A2')
    expect(cmds[1]).toContain('--labelA B1 --labelB B2')
    expect(cmds[2]).toContain('--labelA A1 --labelB B1')
  })

  it('每臂只跑一次時，一條可執行的 brief:quality 指令都不印（含跨臂那條）', () => {
    const out = renderProseReport({ agentName, runs: [proseRun('A1', 'm-a'), proseRun('B1', 'm-b')] })
    expect(out.filter(l => JUDGE_CMD.test(l))).toEqual([])
    expect(out.join('\n')).toContain('不可判讀（缺同臂對照組）')
    expect(out.join('\n')).toContain('臂 A/B 只跑了一次')
  })

  it('只有 A 臂有雙跑時也一樣擋（B 臂沒有雜訊底線就不能比）', () => {
    const runs = [proseRun('A1', 'm-a'), proseRun('A2', 'm-a'), proseRun('B1', 'm-b')]
    const out = renderProseReport({ agentName, runs })
    expect(out.filter(l => JUDGE_CMD.test(l))).toEqual([])
    expect(out.join('\n')).toContain('臂 B 只跑了一次')
  })

  it('沒有任何 run 時不印指令', () => {
    expect(renderProseReport({ agentName, runs: [] }).filter(l => JUDGE_CMD.test(l))).toEqual([])
  })
})

describe('renderStructuredReport：兩條路徑的閘門要對等', () => {
  const agentName = 'corpus-entity-summary'

  it('每臂只跑一次時判定為不可判讀，且分歧清單標明含模型抖動', () => {
    const runs = [structuredRun('A1', 'm-a', ['台積電', 'Helios']), structuredRun('B1', 'm-b', ['台積電', 'Alphabet'])]
    const text = renderStructuredReport({ agentName, runs, divergenceField: 'entities', divergeN: 5 }).join('\n')
    expect(text).toContain('不可判讀（缺同臂對照組）')
    expect(text).toContain('單跑分歧')
    expect(text).toContain('這份清單混著模型自身的抖動')
  })

  it('有同臂雙跑時才會出現一致分歧清單與可判讀的結論', () => {
    const runs = [
      structuredRun('A1', 'm-a', ['台積電', 'Helios']),
      structuredRun('A2', 'm-a', ['台積電', 'Helios']),
      structuredRun('B1', 'm-b', ['台積電']),
      structuredRun('B2', 'm-b', ['台積電']),
    ]
    const text = renderStructuredReport({ agentName, runs, divergenceField: 'entities', divergeN: 5 }).join('\n')
    expect(text).toContain('一致分歧')
    expect(text).not.toContain('不可判讀（缺同臂對照組）')
    expect(text).toContain('只有 A 臂穩定抽到: Helios')
  })
})
