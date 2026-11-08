import { describe, expect, it } from 'vitest'
import { computeSeriesDirection } from './series-direction.js'

const p = (date: string, value: number) => ({ date, value })

describe('computeSeriesDirection — level（存量：比與前值的差）', () => {
  it('比前值高 → up', () => {
    expect(computeSeriesDirection('level', p('2026-07-31', 5074), p('2026-07-30', 4938))).toBe('up')
  })

  it('比前值低 → down', () => {
    expect(computeSeriesDirection('level', p('2026-07-31', 4938), p('2026-07-30', 5074))).toBe('down')
  })

  it('與前值相同 → flat', () => {
    expect(computeSeriesDirection('level', p('2026-07-31', 100), p('2026-07-30', 100))).toBe('flat')
  })

  it('沒有前值 → flat（不拿值的正負當方向）', () => {
    expect(computeSeriesDirection('level', p('2026-07-31', 5074), null)).toBe('flat')
  })

  // 存量本身是負數（例如淨部位）時，方向仍然只看差、不看正負
  it('負值存量回升 → up', () => {
    expect(computeSeriesDirection('level', p('2026-07-31', -20), p('2026-07-30', -50))).toBe('up')
  })
})

describe('computeSeriesDirection — flow（流量：看值本身的正負）', () => {
  it('買超 → up', () => {
    expect(computeSeriesDirection('flow', p('2026-07-31', 873), p('2026-07-30', -495))).toBe('up')
  })

  it('賣超 → down（即使比前一日的賣超少）', () => {
    expect(computeSeriesDirection('flow', p('2026-07-31', -100), p('2026-07-30', -495))).toBe('down')
  })

  it('零 → flat', () => {
    expect(computeSeriesDirection('flow', p('2026-07-31', 0), p('2026-07-30', 500))).toBe('flat')
  })

  it('沒有前值也算得出來（flow 不需要前值）', () => {
    expect(computeSeriesDirection('flow', p('2026-07-31', 873), null)).toBe('up')
  })
})

// 同一組數字兩種 kind 結論相反——這正是不能兩邊各判一次的理由
describe('computeSeriesDirection — level 與 flow 對同一組數字可能相反', () => {
  it('值為負但比前值高：level 判 up、flow 判 down', () => {
    const latest = p('2026-07-31', -100)
    const previous = p('2026-07-30', -495)
    expect(computeSeriesDirection('level', latest, previous)).toBe('up')
    expect(computeSeriesDirection('flow', latest, previous)).toBe('down')
  })
})
