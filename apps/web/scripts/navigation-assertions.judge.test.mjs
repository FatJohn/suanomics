import { describe, expect, it } from 'vitest'
import { judge, judgeOne } from './navigation-assertions.judge.mjs'

describe('judgeOne', () => {
  it('落點與期望相同就是 PASS', () => {
    const v = judgeOne({ label: 'x', expected: '/d/2026-09-01', actual: '/d/2026-09-01' })
    expect(v).toMatchObject({ pass: true })
  })

  it('不同就是 FAIL，detail 兩邊都印出來', () => {
    const v = judgeOne({ label: 'x', expected: '/d/2026-09-01', actual: '/' })
    expect(v).toMatchObject({ pass: false })
    expect(v.detail).toEqual(['期望 /d/2026-09-01', '實際 /'])
  })

  // ★ 素材缺席要記成 SKIP、不能是 PASS 也不能是 FAIL：前者發假綠燈，後者把人指向不存在的 bug
  it('有 skipReason 時既不 PASS 也不 FAIL', () => {
    const v = judgeOne({ label: 'x', skipReason: '當天沒有帶 newsId 的來源' })
    expect(v).toEqual({ label: 'x', skip: '當天沒有帶 newsId 的來源' })
    expect('pass' in v).toBe(false)
  })

  // ★ skipReason 優先於比對：素材缺席時 actual 本來就沒有意義
  it('skipReason 蓋過 expected／actual', () => {
    const v = judgeOne({ label: 'x', expected: '/a', actual: '/b', skipReason: '沒有第二天' })
    expect(v).toEqual({ label: 'x', skip: '沒有第二天' })
  })
})

describe('judge', () => {
  it('分成 assertions 與 skipped 兩堆、failed 只數 assertions', () => {
    const r = judge([
      { label: 'a', expected: '/x', actual: '/x' },
      { label: 'b', expected: '/y', actual: '/z' },
      { label: 'c', skipReason: '素材缺席' },
    ])
    expect(r.assertions).toHaveLength(2)
    expect(r.skipped).toEqual([{ label: 'c', reason: '素材缺席' }])
    expect(r.failed).toBe(1)
  })

  // ★ 負向對照：跳過的不算通過，也不算失敗——斷言總數會看得見地掉下來
  it('全部跳過時 failed 是 0 而 assertions 是空的', () => {
    const r = judge([{ label: 'a', skipReason: '沒資料' }])
    expect(r.failed).toBe(0)
    expect(r.assertions).toEqual([])
  })
})
