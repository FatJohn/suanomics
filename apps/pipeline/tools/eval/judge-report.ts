import type { ContinuityScore } from './continuity-judge.js'
import type { QualityScore } from './quality-judge.js'

export interface JudgeRow<S> { date: string, score: S, costUsd: number }

const FALSIFIER_LABEL = { 'pass': '有', 'fail': '無', 'pass-unverified': '證據不符' } as const

function table<S>(header: string[], rows: readonly JudgeRow<S>[], cells: (s: S) => (string | number)[]): string {
  const line = (values: (string | number)[]) => `| ${values.join(' | ')} |`
  const total = rows.reduce((sum, r) => sum + r.costUsd, 0)
  return [
    line([...header, '花費 (USD)']),
    line([...header, '花費 (USD)'].map(() => '---')),
    ...rows.map(r => line([r.date, ...cells(r.score), r.costUsd.toFixed(4)])),
    line(['合計', ...header.slice(1).map(() => ''), total.toFixed(4)]),
  ].join('\n')
}

export function renderQualityTable(rows: readonly JudgeRow<QualityScore>[]): string {
  return table(
    ['日期', '傳導鏈完整', '管道具體', '無依據數字', '無依據事件', '套話', '反證條件', '未計分'],
    rows,
    s => [
      `${s.chainPass}/${s.sections}`,
      `${s.mechanismPass}/${s.sections}`,
      s.unsupportedNumbers,
      s.unsupportedEvents,
      s.boilerplate.length,
      FALSIFIER_LABEL[s.falsifier],
      s.unverifiedPasses + s.unmatchedQuotes + s.missingSections.length,
    ],
  )
}

export function renderContinuityTable(rows: readonly JudgeRow<ContinuityScore>[]): string {
  return table(
    ['日期', '有進展敘事線', '有新增量', '重述', '未提', '昨日待觀察', '已交代', '未交代', '未到期', '假連續', '重述句', '未計分'],
    rows,
    s => [
      s.touched,
      s.delta,
      s.restated,
      s.absent,
      s.carryOverItems,
      s.addressed,
      s.notAddressed,
      s.notDue,
      s.falseContinuity,
      s.restatements,
      s.unverified + s.missingStorylines.length,
    ],
  )
}
