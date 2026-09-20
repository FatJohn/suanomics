import { describe, expect, it, vi } from 'vitest'
import {
  enforceLlmRunBudget,
  estimateTotalCalls,
  formatLlmRunBudgetReport,
  hasYesFlag,
  judgeLlmRunBudget,
} from './llm-run-budget.js'

function term(overrides: Partial<{ label: string, units: number, callsPerUnit: number, httpMultiplier: number, basis: string }> = {}) {
  return {
    label: 'x',
    units: 1,
    callsPerUnit: 1,
    httpMultiplier: 3,
    basis: 'test-basis',
    ...overrides,
  }
}

describe('estimateTotalCalls', () => {
  it('把每個 term 的 units × callsPerUnit 加總', () => {
    const e = { script: 's', terms: [term({ units: 3, callsPerUnit: 2 }), term({ units: 5, callsPerUnit: 1 })], peak: 1, peakBasis: 'b', caveats: [] }
    expect(estimateTotalCalls(e)).toBe(3 * 2 + 5 * 1)
  })

  it('units 非非負整數（含 NaN）拋錯，不當 0', () => {
    const e = { script: 's', terms: [term({ units: Number.NaN })], peak: 1, peakBasis: 'b', caveats: [] }
    expect(() => estimateTotalCalls(e)).toThrow()
  })

  it('callsPerUnit 是負數拋錯', () => {
    const e = { script: 's', terms: [term({ callsPerUnit: -1 })], peak: 1, peakBasis: 'b', caveats: [] }
    expect(() => estimateTotalCalls(e)).toThrow()
  })

  it('peak 非非負整數拋錯', () => {
    const e = { script: 's', terms: [term()], peak: Number.NaN, peakBasis: 'b', caveats: [] }
    expect(() => estimateTotalCalls(e)).toThrow()
  })
})

describe('judgeLlmRunBudget', () => {
  it('500 次剛好在門檻內、peak 10 也在門檻內 → within', () => {
    const e = { script: 's', terms: [term({ units: 500, callsPerUnit: 1 })], peak: 10, peakBasis: 'b', caveats: [] }
    expect(judgeLlmRunBudget(e, { confirmed: false })).toEqual({ verdict: 'within', exceeded: [] })
  })

  it('501 次超過門檻（> 改 >= 會讓 500 那條也判超標而紅）', () => {
    const e = { script: 's', terms: [term({ units: 501, callsPerUnit: 1 })], peak: 1, peakBasis: 'b', caveats: [] }
    const j = judgeLlmRunBudget(e, { confirmed: false })
    expect(j.exceeded).toEqual(['calls'])
  })

  it('peak 10 在門檻內、peak 11 超過（> 改 >= 會讓 10 也判超標而紅）', () => {
    const within = judgeLlmRunBudget({ script: 's', terms: [term({ units: 1, callsPerUnit: 1 })], peak: 10, peakBasis: 'b', caveats: [] }, { confirmed: false })
    expect(within.exceeded).toEqual([])
    const over = judgeLlmRunBudget({ script: 's', terms: [term({ units: 1, callsPerUnit: 1 })], peak: 11, peakBasis: 'b', caveats: [] }, { confirmed: false })
    expect(over.exceeded).toEqual(['peak'])
  })

  it('超標且未確認 → over-unconfirmed', () => {
    const e = { script: 's', terms: [term({ units: 501, callsPerUnit: 1 })], peak: 1, peakBasis: 'b', caveats: [] }
    expect(judgeLlmRunBudget(e, { confirmed: false }).verdict).toBe('over-unconfirmed')
  })

  it('超標且已確認（--yes）→ over-confirmed', () => {
    const e = { script: 's', terms: [term({ units: 501, callsPerUnit: 1 })], peak: 1, peakBasis: 'b', caveats: [] }
    expect(judgeLlmRunBudget(e, { confirmed: true }).verdict).toBe('over-confirmed')
  })

  it('calls 與 peak 同時超標時 exceeded 兩者都列', () => {
    const e = { script: 's', terms: [term({ units: 501, callsPerUnit: 1 })], peak: 11, peakBasis: 'b', caveats: [] }
    expect(judgeLlmRunBudget(e, { confirmed: false }).exceeded).toEqual(['calls', 'peak'])
  })
})

describe('hasYesFlag', () => {
  it('只認完全等於 --yes', () => {
    expect(hasYesFlag(['--yes'])).toBe(true)
    expect(hasYesFlag(['-d', '2026-01-01', '--yes'])).toBe(true)
  })

  it('前綴相符但不是完全相等時不算（startsWith 誤判會讓這條紅）', () => {
    expect(hasYesFlag(['--yesterday'])).toBe(false)
    expect(hasYesFlag(['--yes-please'])).toBe(false)
  })

  it('沒有旗標時為 false', () => {
    expect(hasYesFlag([])).toBe(false)
  })
})

describe('formatLlmRunBudgetReport', () => {
  it('報告含每項明細、總數、HTTP 最壞值、尖峰、兩個門檻與依據', () => {
    const e = {
      script: 'test-script',
      terms: [term({ label: 'replicate', units: 4, callsPerUnit: 150, httpMultiplier: 3, basis: 'fanout-concurrency.ts:X' })],
      peak: 4,
      peakBasis: 'orchestrator.ts:289',
      caveats: ['caveat 一行'],
    }
    const j = judgeLlmRunBudget(e, { confirmed: false }) // 4*150=600 > 500，觸發超標分支
    const report = formatLlmRunBudgetReport(e, j)
    expect(report).toContain('test-script')
    expect(report).toContain('replicate')
    expect(report).toContain('600') // 4*150 明細
    expect(report).toContain('1800') // HTTP 最壞值 600*3
    expect(report).toContain('fanout-concurrency.ts:X')
    expect(report).toContain('orchestrator.ts:289')
    expect(report).toContain('caveat 一行')
    expect(report).toContain('--yes')
  })

  it('不給 narrowingHint → 縮小範圍提示維持預設字串逐字不變', () => {
    const e = { script: 's', terms: [term({ units: 501, callsPerUnit: 1 })], peak: 1, peakBasis: 'b', caveats: [] }
    const j = judgeLlmRunBudget(e, { confirmed: false })
    const report = formatLlmRunBudgetReport(e, j)
    expect(report).toContain('加 --yes 略過，或用 --limit／--dates／--replicates 縮小範圍。')
  })

  it('給 narrowingHint → 取代預設字串，不是兩者並存', () => {
    const e = { script: 's', terms: [term({ units: 501, callsPerUnit: 1 })], peak: 1, peakBasis: 'b', caveats: [] }
    const j = judgeLlmRunBudget(e, { confirmed: false })
    const report = formatLlmRunBudgetReport(e, j, '調小 sinceDays')
    expect(report).toContain('加 --yes 略過，或用 調小 sinceDays 縮小範圍。')
    expect(report).not.toContain('--limit／--dates／--replicates')
    expect(report).toContain('--yes')
  })
})

describe('enforceLlmRunBudget', () => {
  const baseEstimate = (units: number, peak: number) => ({
    script: 's',
    terms: [term({ units, callsPerUnit: 1 })],
    peak,
    peakBasis: 'b',
    caveats: [],
  })

  it('within：印一行、不呼叫 exit', () => {
    const errLog = vi.fn()
    const exit = vi.fn()
    enforceLlmRunBudget(baseEstimate(1, 1), { confirmed: false, errLog, exit })
    expect(exit).not.toHaveBeenCalled()
    expect(errLog).toHaveBeenCalledTimes(1)
  })

  it('over + confirmed：印明細、不呼叫 exit（忽略 confirmed 會讓這條紅）', () => {
    const errLog = vi.fn()
    const exit = vi.fn()
    enforceLlmRunBudget(baseEstimate(501, 1), { confirmed: true, errLog, exit })
    expect(exit).not.toHaveBeenCalled()
    expect(errLog.mock.calls.some(c => String(c[0]).includes('501') || String(c[0]).includes('exceeded'))).toBe(true)
  })

  it('over + 未確認：明細先寫到 errLog、再 exit(3)（改 exit(1) 或明細改印別處都會紅）', () => {
    const errLog = vi.fn()
    const exit = vi.fn()
    enforceLlmRunBudget(baseEstimate(501, 1), { confirmed: false, errLog, exit })
    expect(errLog).toHaveBeenCalled()
    expect(exit).toHaveBeenCalledWith(3)
    const errLogOrder = errLog.mock.invocationCallOrder[0]
    const exitOrder = exit.mock.invocationCallOrder[0]
    expect(errLogOrder as number).toBeLessThan(exitOrder as number)
  })
})
