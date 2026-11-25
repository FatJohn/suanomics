import { describe, expect, it } from 'vitest'
import { pendingJudges } from './judge-plan.js'

describe('pendingJudges', () => {
  it('帳本裡已有 ok 紀錄的 judge 不再跑，其餘照要求的順序保留', () => {
    expect(pendingJudges(['quality', 'continuity'], ['brief-quality-judge'])).toEqual(['continuity'])
    expect(pendingJudges(['quality', 'continuity'], ['brief-continuity-judge', 'brief-quality-judge'])).toEqual([])
  })

  it('帳本沒有紀錄或只有別的 agent 時全部照跑', () => {
    expect(pendingJudges(['quality', 'continuity'], [])).toEqual(['quality', 'continuity'])
    expect(pendingJudges(['continuity'], ['editor', 'brief-quality-judge'])).toEqual(['continuity'])
  })
})
