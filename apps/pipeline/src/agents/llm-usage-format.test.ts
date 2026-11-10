import { describe, expect, it } from 'vitest'
import { renderDailyUsage, renderRunSummary } from './llm-usage-format.js'

describe('renderRunSummary', () => {
  it('列出總額、呼叫數、失敗重試與各 agent', () => {
    const md = renderRunSummary('gh-1-1', {
      totalUsd: 1.23456,
      calls: 85,
      failed: 2,
      retries: 3,
      byAgent: [{ agent: 'editor', calls: 1, failed: 0, retries: 0, usd: 0.5 }],
    })
    expect(md).toContain('$1.2346')
    expect(md).toContain('85')
    expect(md).toContain('| editor | 1 | 0 | 0 | $0.5000 |')
    expect(md).toContain('失敗 2')
    expect(md).toContain('重試 3')
    expect(md).toContain('金額未知')
  })

  it('沒有呼叫時明講，不輸出空表', () => {
    const md = renderRunSummary('r', { totalUsd: 0, calls: 0, failed: 0, retries: 0, byAgent: [] })
    expect(md).toContain('沒有 LLM 呼叫')
    expect(md).not.toContain('| agent |')
  })
})

describe('renderDailyUsage', () => {
  it('每日一段，含 agent 與 model 拆分', () => {
    const out = renderDailyUsage([{
      day: '2026-11-09',
      totalUsd: 1,
      calls: 3,
      failed: 1,
      byAgent: [{ agent: 'editor', calls: 3, usd: 1 }],
      byModel: [{ model: 'claude-haiku-5-5', calls: 3, usd: 1 }],
    }])
    expect(out).toContain('2026-11-09  $1.0000  calls=3  failed=1')
    expect(out).toContain('agent editor')
    expect(out).toContain('model claude-haiku-5-5')
  })

  it('空結果明講', () => {
    expect(renderDailyUsage([])).toContain('沒有資料')
  })
})
