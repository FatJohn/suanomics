import { describe, expect, it } from 'vitest'
import { parseCategoryFloors, selectWithCategoryFloors } from './selection.js'

const item = (id: number, category: 'macro' | 'energy' | 'other' | 'geopolitics') => ({ id, category })

describe('selectWithCategoryFloors', () => {
  it('高產量類別不會吃掉其他類的保底名額', () => {
    const candidates = [item(1, 'macro'), item(2, 'macro'), item(3, 'macro'), item(4, 'energy'), item(5, 'other')]
    const out = selectWithCategoryFloors(candidates, { total: 3, floors: { energy: 1, other: 1 } })
    expect(out.map(c => c.id)).toEqual([1, 4, 5])
  })
  it('保底之外依輸入順序補滿 total，輸出維持輸入順序', () => {
    const candidates = [item(1, 'macro'), item(2, 'energy'), item(3, 'macro'), item(4, 'macro')]
    const out = selectWithCategoryFloors(candidates, { total: 3, floors: { energy: 1 } })
    expect(out.map(c => c.id)).toEqual([1, 2, 3])
  })
  it('某類候選不足保底時，名額讓給其他類', () => {
    const candidates = [item(1, 'macro'), item(2, 'macro'), item(3, 'macro')]
    const out = selectWithCategoryFloors(candidates, { total: 3, floors: { energy: 2 } })
    expect(out.map(c => c.id)).toEqual([1, 2, 3])
  })
  it('保底同類取排序最前的幾則', () => {
    const candidates = [item(1, 'energy'), item(2, 'energy'), item(3, 'macro')]
    const out = selectWithCategoryFloors(candidates, { total: 1, floors: { energy: 1 } })
    expect(out.map(c => c.id)).toEqual([1])
  })
  it('保底總和超過 total 是設定錯誤', () => {
    expect(() => selectWithCategoryFloors([], { total: 1, floors: { energy: 1, macro: 1 } })).toThrow(/total/)
  })
})

describe('parseCategoryFloors', () => {
  it('未設定時用預設值，且每類都有保底', () => {
    expect(parseCategoryFloors(undefined)).toEqual({ 'macro': 6, 'geopolitics': 4, 'industry': 6, 'energy': 3, 'disaster-health': 2, 'other': 2 })
  })
  it('覆寫指定類別，其餘沿用預設', () => {
    expect(parseCategoryFloors('energy:5,other:0')).toMatchObject({ energy: 5, other: 0, macro: 6 })
  })
  it('未知類別或非整數名額直接報錯，不靜默失效', () => {
    expect(() => parseCategoryFloors('tech-semi:2')).toThrow(/tech-semi/)
    expect(() => parseCategoryFloors('energy:x')).toThrow(/energy:x/)
  })
})
