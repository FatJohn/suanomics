import { describe, expect, it } from 'vitest'
import { buildContinuityReport } from './continuity-report.js'

const RESULT = {
  crossDay: { winner: 'B' as const, reasons: ['r1', 'r2'] },
  thesisDelta: { winner: 'A' as const, reasons: ['r3', 'r4'] },
  resolvePayoff: { winner: 'tie' as const, reasons: ['r5', 'r6'] },
}
const META = { labelA: 'stateless', labelB: 'continuity', model: 'gemini-3.5-flash', tokensIn: 100, tokensOut: 20, costUsd: 0.06 }

describe('buildContinuityReport', () => {
  it('勝方映回 label（B→continuity、A→stateless、tie→相當）+ 兩理由 + meta', () => {
    const md = buildContinuityReport(RESULT, META)
    expect(md).toContain('# Brief Continuity Compare：stateless vs continuity')
    expect(md).toContain('跨日連貫：continuity') // crossDay winner B → labelB
    expect(md).toContain('論點演進：stateless') // thesisDelta winner A → labelA
    expect(md).toContain('伏筆兌現：相當') // resolvePayoff tie
    // 三維 × 兩 orientation 共 6 個理由都要 render（含中段 r2–r5、非只首尾）
    for (const r of ['r1', 'r2', 'r3', 'r4', 'r5', 'r6'])
      expect(md).toContain(r)
    expect(md).toContain('gemini-3.5-flash')
  })
})
