import { describe, expect, it } from 'vitest'
import { resolveSectionRef } from './viewpoint-refs.js'

describe('resolveSectionRef', () => {
  it('段落數內的整數原樣保留', () => {
    expect(resolveSectionRef(1, 3)).toBe(1)
    expect(resolveSectionRef(3, 3)).toBe(3)
  })
  it('null 是整體性論點', () => {
    expect(resolveSectionRef(null, 3)).toBeNull()
  })
  it('對不到現有段落的參照改標整體性論點', () => {
    expect(resolveSectionRef(0, 3)).toBeNull()
    expect(resolveSectionRef(-1, 3)).toBeNull()
    expect(resolveSectionRef(4, 3)).toBeNull()
    expect(resolveSectionRef(1.5, 3)).toBeNull()
    expect(resolveSectionRef(Number.NaN, 3)).toBeNull()
  })
  it('沒有段落時一律整體性', () => {
    expect(resolveSectionRef(1, 0)).toBeNull()
  })
})
