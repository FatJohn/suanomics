import { describe, expect, it } from 'vitest'
import { aggregateDim, mapWinner } from './pairwise.js'

describe('mapWinner（甲/乙 映回 A/B、依該 orientation 誰是甲）', () => {
  it('firstIsA=true：甲→A、乙→B、相當→tie', () => {
    expect(mapWinner('甲', true)).toBe('A')
    expect(mapWinner('乙', true)).toBe('B')
    expect(mapWinner('相當', true)).toBe('tie')
  })
  it('firstIsA=false（B 當甲）：甲→B、乙→A、相當→tie', () => {
    expect(mapWinner('甲', false)).toBe('B')
    expect(mapWinner('乙', false)).toBe('A')
    expect(mapWinner('相當', false)).toBe('tie')
  })
})

describe('aggregateDim（兩 orientation 一致才判勝、否則 tie）', () => {
  it('兩次同 A → A、同 B → B', () => {
    expect(aggregateDim('A', 'A')).toBe('A')
    expect(aggregateDim('B', 'B')).toBe('B')
  })
  it('矛盾或含 tie → tie', () => {
    expect(aggregateDim('A', 'B')).toBe('tie')
    expect(aggregateDim('A', 'tie')).toBe('tie')
    expect(aggregateDim('tie', 'B')).toBe('tie')
  })
})
