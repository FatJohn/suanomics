import { describe, expect, it } from 'vitest'
import { summarizeStorylineRows } from './storyline-activity.js'

// `open`／`total` 是**全表**的數字，所以它們的斷言不能寫在真 DB 測試裡：同一個 package 的
// storylines-repo.test.ts 會在同一張表上 insert open 線、還會跑不分前綴的 auto-dormant
// sweep，vitest 又是平行跑檔案（那支插幾條、怎麼擋 sweep，**這裡刻意不複述**，看它自己的
// `不傳 openCap 時預設上限就是 10` 與 `applyForTest`）。改成增量斷言也擋不住——污染發生在
// 前後兩次讀之間。
// 2026-08-23 實測那種寫法三次跑紅一次，而且錯誤訊息（`expected 3 to be 2`）與真回歸
// 一模一樣，下一次真的壞掉會被當成 flake 忽略。所以計數搬進純函式在這裡測。
const D1 = '2026-08-21'
const D2 = '2026-08-23'
const upd = (briefDate: string, note: unknown = '這條線今天有進展') => ({ briefDate, valence: 'support', note })

describe('summarizeStorylineRows', () => {
  it('open 只數 status open，total 數全表', () => {
    const r = summarizeStorylineRows([
      { status: 'open', updates: [] },
      { status: 'open', updates: [] },
      { status: 'dormant', updates: [] },
      { status: 'confirmed', updates: [] },
      { status: 'refuted', updates: [] },
    ], [])
    expect(r).toEqual({ open: 2, total: 5, byDate: {} })
  })

  it('★ 池子空了但表沒空：open 0／total 20 是「有列但不能用」', () => {
    const rows = Array.from({ length: 20 }, () => ({ status: 'dormant', updates: [] }))
    expect(summarizeStorylineRows(rows, [])).toMatchObject({ open: 0, total: 20 })
  })

  it('逐日數被觸及的敘事線，不分 status', () => {
    const r = summarizeStorylineRows([
      { status: 'open', updates: [upd(D1), upd(D2)] },
      { status: 'dormant', updates: [upd(D1)] },
      { status: 'confirmed', updates: [upd(D2)] },
    ], [D1, D2])
    expect(r.byDate).toEqual({ [D1]: { touched: 2, usable: 2 }, [D2]: { touched: 2, usable: 2 } })
  })

  it('沒被問到的日期不出現，被問到但沒人碰的日期回 0（鍵不可以消失）', () => {
    const r = summarizeStorylineRows([{ status: 'open', updates: [upd(D1)] }], [D2])
    expect(r.byDate).toEqual({ [D2]: { touched: 0, usable: 0 } })
  })

  it('★ note 空白算 touched 不算 usable（那條線進不了 storylineBlock）', () => {
    const r = summarizeStorylineRows([
      { status: 'open', updates: [upd(D1, '   ')] },
      { status: 'open', updates: [upd(D1, '有內容')] },
      { status: 'open', updates: [{ briefDate: D1, valence: 'support' }] },
      { status: 'open', updates: [upd(D1, 42)] },
    ], [D1])
    expect(r.byDate[D1]).toEqual({ touched: 4, usable: 1 })
  })

  it('updates 裡的雜項不會炸也不會誤計', () => {
    const r = summarizeStorylineRows([
      { status: 'open', updates: ['字串', null, { valence: 'support', note: 'x' }, { briefDate: 20260821, note: 'x' }, upd(D1)] },
    ], [D1])
    expect(r.byDate[D1]).toEqual({ touched: 1, usable: 1 })
  })

  it('updates 不是陣列的列照樣算進 open／total，只是沒有逐日貢獻', () => {
    const r = summarizeStorylineRows([
      { status: 'open', updates: { nope: true } },
      { status: 'open', updates: null },
    ], [D1])
    expect(r).toEqual({ open: 2, total: 2, byDate: { [D1]: { touched: 0, usable: 0 } } })
  })

  it('★ 不合 schema 的 update 照樣算——健康訊號不可以把「壞掉」變成「不存在」', () => {
    // 少了 valence，storylines-repo 的 toStorylineSafe 會 warn 之後整列回 null
    const r = summarizeStorylineRows([{ status: 'open', updates: [{ briefDate: D1, note: '缺 valence' }] }], [D1])
    expect(r.byDate[D1]).toEqual({ touched: 1, usable: 1 })
  })

  it('空表回 open 0／total 0，不是丟例外', () => {
    expect(summarizeStorylineRows([], [D1])).toEqual({ open: 0, total: 0, byDate: { [D1]: { touched: 0, usable: 0 } } })
  })
})
