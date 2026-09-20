import { describe, expect, it } from 'vitest'
import { buildCompareReport } from './quality-report.js'

const RESULT = {
  depth: { winner: 'B' as const, reasons: ['r1', 'r2'] },
  readability: { winner: 'A' as const, reasons: ['r3', 'r4'] },
  grounding: { winner: 'tie' as const, reasons: ['r5', 'r6'] },
}
const META = { labelA: 'gemini', labelB: 'claude', model: 'gemini-3.5-flash', tokensIn: 100, tokensOut: 20, costUsd: 0.06, sourceCount: 6 }

describe('buildCompareReport', () => {
  it('勝方映回 label（B→claude、A→gemini、tie→相當）+ 兩理由 + meta', () => {
    const md = buildCompareReport(RESULT, META)
    expect(md).toContain('# Brief Quality Compare：gemini vs claude')
    expect(md).toContain('解讀深度：claude') // depth winner B → labelB
    expect(md).toContain('可讀性：gemini') // readability winner A → labelA
    expect(md).toContain('可信度：相當') // grounding tie
    expect(md).toContain('r1')
    expect(md).toContain('r6')
    expect(md).toContain('gemini-3.5-flash')
  })
})
