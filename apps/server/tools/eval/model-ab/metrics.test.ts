import { describe, expect, it } from 'vitest'
import { billableInputUnits, mean, median, pairStat, pct, recoverPrices } from './metrics.js'

describe('pairStat：集合重疊（Jaccard / recall / precision）', () => {
  it('完全一致 → 三個指標都是 1', () => {
    const s = pairStat(['a', 'b'], ['b', 'a'])
    expect(s.jaccard).toBe(1)
    expect(s.recall).toBe(1)
    expect(s.precision).toBe(1)
  })

  it('部分重疊 → 三個指標各自算對', () => {
    const s = pairStat(['a', 'b', 'c'], ['b', 'c', 'd'])
    expect(s.refCount).toBe(3)
    expect(s.candCount).toBe(3)
    expect(s.inter).toBe(2)
    expect(s.recall).toBeCloseTo(2 / 3, 10)
    expect(s.precision).toBeCloseTo(2 / 3, 10)
    expect(s.jaccard).toBeCloseTo(0.5, 10)
  })

  it('重複值只算一次（set 語意、同一實體抽兩次不該灌高分母）', () => {
    const s = pairStat(['a', 'a', 'b'], ['a', 'b'])
    expect(s.refCount).toBe(2)
    expect(s.jaccard).toBe(1)
  })

  it('兩邊都空 → 視為一致（1）而不是 0/0', () => {
    expect(pairStat([], []).jaccard).toBe(1)
  })

  it('ref 空、cand 有東西 → recall 1、precision 0、jaccard 0', () => {
    const s = pairStat([], ['a'])
    expect(s.recall).toBe(1)
    expect(s.precision).toBe(0)
    expect(s.jaccard).toBe(0)
  })
})

describe('recoverPrices：從 (tokensIn, tokensOut, costUsd) 反推 $/1M 單價', () => {
  // 這是「兩臂真的跑在不同 model」的硬證據——AGENT_MODELS 設了不代表 llm-wrapper 收了，
  // 但帳算出來的單價騙不了人。定價表 flash=1.50/9.00、flash-lite=0.30/2.50。
  const priced = (input: number, output: number) =>
    [
      { inUnits: 10_000, out: 500 },
      { inUnits: 4_000, out: 1_200 },
      { inUnits: 25_000, out: 300 },
    ].map(r => ({ ...r, cost: (r.inUnits * input + r.out * output) / 1_000_000 }))

  it('還原 gemini-3.5-flash 的 1.50 / 9.00', () => {
    const p = recoverPrices(priced(1.5, 9))
    expect(p.input).toBeCloseTo(1.5, 6)
    expect(p.output).toBeCloseTo(9, 6)
  })

  it('還原 gemini-3.5-flash-lite 的 0.30 / 2.50', () => {
    const p = recoverPrices(priced(0.3, 2.5))
    expect(p.input).toBeCloseTo(0.3, 6)
    expect(p.output).toBeCloseTo(2.5, 6)
  })

  it('資料共線（每筆 in/out 比例都一樣）→ 回 null、不硬掰一組數字', () => {
    const rows = [
      { inUnits: 1000, out: 100, cost: (1000 * 1.5 + 100 * 9) / 1e6 },
      { inUnits: 2000, out: 200, cost: (2000 * 1.5 + 200 * 9) / 1e6 },
    ]
    expect(recoverPrices(rows)).toEqual({ input: null, output: null })
  })

  it('空輸入 → null', () => {
    expect(recoverPrices([])).toEqual({ input: null, output: null })
  })
})

describe('billableInputUnits：cached read token 只計 25%', () => {
  it('沒有 cache 命中時等於 tokensIn', () => {
    expect(billableInputUnits({ tokensIn: 1000, cachedReadTokens: 0 })).toBe(1000)
  })

  it('有 cache 命中時把那部分折成 25%', () => {
    expect(billableInputUnits({ tokensIn: 1000, cachedReadTokens: 400 })).toBe(600 + 100)
  })
})

describe('mean / median / pct', () => {
  it('mean 空陣列回 0（不是 NaN）', () => {
    expect(mean([])).toBe(0)
    expect(mean([1, 2, 3, 4])).toBe(2.5)
  })

  it('median 取排序後的中位（偶數筆取上中位）', () => {
    expect(median([])).toBe(0)
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 3, 2])).toBe(3)
  })

  it('pct 印成一位小數的百分比', () => {
    expect(pct(0.6337)).toBe('63.4%')
    expect(pct(1)).toBe('100.0%')
  })
})
