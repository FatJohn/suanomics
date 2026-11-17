import type { ContinuityScore } from './continuity-judge.js'
import type { QualityScore } from './quality-judge.js'
import { describe, expect, it } from 'vitest'
import { renderContinuityTable, renderQualityTable } from './judge-report.js'

const quality: QualityScore = {
  sections: 3,
  chainPass: 2,
  mechanismPass: 1,
  unverifiedPasses: 1,
  missingSections: ['台股資金'],
  unsupportedNumbers: 4,
  unsupportedEvents: 1,
  unmatchedQuotes: 2,
  boilerplate: [{ phrase: '值得持續觀察', blocks: 3 }],
  falsifier: 'pass-unverified',
}

const continuity: ContinuityScore = {
  touched: 3,
  delta: 1,
  restated: 1,
  absent: 0,
  missingStorylines: [7],
  carryOverItems: 4,
  addressed: 1,
  notAddressed: 1,
  notDue: 2,
  falseContinuity: 0,
  restatements: 2,
  unverified: 1,
}

describe('renderQualityTable', () => {
  it('一天一列，未計分＝證據不符＋引文不符＋漏判段落，最後一列是花費合計', () => {
    const table = renderQualityTable([{ date: '2026-11-17', score: quality, costUsd: 0.1234 }, { date: '2026-11-16', score: quality, costUsd: 0.2 }])
    const lines = table.split('\n')
    expect(lines[0]).toBe('| 日期 | 傳導鏈完整 | 管道具體 | 無依據數字 | 無依據事件 | 套話 | 反證條件 | 未計分 | 花費 (USD) |')
    expect(lines[2]).toBe('| 2026-11-17 | 2/3 | 1/3 | 4 | 1 | 1 | 證據不符 | 4 | 0.1234 |')
    expect(lines.at(-1)).toBe('| 合計 |  |  |  |  |  |  |  | 0.3234 |')
  })
})

describe('renderContinuityTable', () => {
  it('一天一列，未計分＝引文不符＋漏判敘事線', () => {
    const lines = renderContinuityTable([{ date: '2026-11-17', score: continuity, costUsd: 0.05 }]).split('\n')
    expect(lines[0]).toBe('| 日期 | 有進展敘事線 | 有新增量 | 重述 | 未提 | 昨日待觀察 | 已交代 | 未交代 | 未到期 | 假連續 | 重述句 | 未計分 | 花費 (USD) |')
    expect(lines[2]).toBe('| 2026-11-17 | 3 | 1 | 1 | 0 | 4 | 1 | 1 | 2 | 0 | 2 | 2 | 0.0500 |')
    expect(lines.at(-1)).toBe('| 合計 |  |  |  |  |  |  |  |  |  |  |  | 0.0500 |')
  })
})
