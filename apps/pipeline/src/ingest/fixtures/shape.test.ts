import { describe, expect, it } from 'vitest'
import { diffShape, hasBreakingDrift, shapeOf } from './shape.js'

describe('shapeOf', () => {
  it('攤平成 path → 型別，root 是空字串', () => {
    expect(shapeOf({ a: 1, b: 'x' })).toEqual({
      '': { types: ['object'], required: true },
      '.a': { types: ['number'], required: true },
      '.b': { types: ['string'], required: true },
    })
  })

  it('陣列元素走 [] 這個 path，不逐 index 展開', () => {
    const s = shapeOf([{ a: 1 }, { a: 2 }])
    expect(Object.keys(s).sort()).toEqual(['', '[]', '[].a'])
    expect(s['[].a']?.required).toBe(true)
  })

  it('欄位只出現在部分元素 → required=false', () => {
    const s = shapeOf([{ a: 1, b: 2 }, { a: 3 }])
    expect(s['[].a']?.required).toBe(true)
    expect(s['[].b']?.required).toBe(false)
  })

  it('同一個 path 出現多種型別就全收', () => {
    const s = shapeOf([{ v: 1 }, { v: 'x' }])
    expect(s['[].v']?.types).toEqual(['number', 'string'])
  })

  it('null 與 undefined 分得開（null 是 API 明確給的空值）', () => {
    const s = shapeOf({ a: null })
    expect(s['.a']?.types).toEqual(['null'])
  })

  // 值不進形狀，這是整個設計的前提：外部 API 的值天天變，比值只會天天紅。
  it('值不影響形狀', () => {
    expect(shapeOf({ price: 1 })).toEqual(shapeOf({ price: 99999 }))
    expect(shapeOf([{ d: '1150601' }])).toEqual(shapeOf([{ d: '1150822' }]))
  })

  it('大陣列只取樣前 N 筆', () => {
    const big = Array.from({ length: 500 }, (_, i) => (i < 20 ? { a: 1 } : { a: 1, late: 1 }))
    expect(shapeOf(big)['[].late']).toBeUndefined()
  })

  // 這條是實作時踩到的：陣列元素的出現次數等於元素個數，若拿去跟父層次數比，
  // 「樣本 1 筆、現況 2 筆」會被誤判成「欄位變成偶爾才有」。
  it('陣列元素本身恆為 required，元素個數不同不算漂移', () => {
    expect(shapeOf([{ a: 1 }])['[]']?.required).toBe(true)
    expect(shapeOf([{ a: 1 }, { a: 2 }, { a: 3 }])['[]']?.required).toBe(true)
  })

  it('巢狀物件的 path 用 . 串接', () => {
    const s = shapeOf({ outer: { inner: [1] } })
    expect(Object.keys(s).sort()).toEqual(['', '.outer', '.outer.inner', '.outer.inner[]'])
  })
})

describe('diffShape', () => {
  const fixture = shapeOf([{ Date: '1150601', TAIEX: '45337.91' }])

  it('形狀相同時零漂移（反向對照）', () => {
    expect(diffShape(fixture, shapeOf([{ Date: '1150822', TAIEX: '46000.00' }]))).toEqual([])
  })

  // 這條就是 firecrawl 那個坑：client 讀 markdown，而真實 API 回的是 description。
  it('欄位消失是 breaking', () => {
    const drifts = diffShape(fixture, shapeOf([{ Date: '1150822' }]))
    expect(drifts.filter(d => d.severity === 'breaking').map(d => d.path)).toEqual(['[].TAIEX'])
  })

  it('型別完全換掉是 breaking', () => {
    const drifts = diffShape(fixture, shapeOf([{ Date: '1150822', TAIEX: 46000 }]))
    expect(drifts.find(d => d.path === '[].TAIEX')?.severity).toBe('breaking')
  })

  it('原本每筆都有變成偶爾才有是 breaking', () => {
    const drifts = diffShape(fixture, shapeOf([{ Date: '1', TAIEX: '2' }, { Date: '3' }]))
    expect(drifts.find(d => d.path === '[].TAIEX')?.severity).toBe('breaking')
  })

  // 分級的理由：多欄位不會弄壞解析，報成 breaking 只會讓這支工具很快被無視。
  it('多出新欄位只是 info', () => {
    const drifts = diffShape(fixture, shapeOf([{ Date: '1', TAIEX: '2', NewField: 'x' }]))
    expect(drifts).toHaveLength(1)
    expect(drifts[0]).toMatchObject({ path: '[].NewField', severity: 'info' })
    expect(hasBreakingDrift(drifts)).toBe(false)
  })

  // 2026-08-22 驗收指出：只看「型別有沒有交集」會放過欄位開始回 null 這種漂移，而那
  // 正是會讓沒有 null 檢查的呼叫端在某一筆炸掉的情況。
  it('現況開始回 null 是 breaking，即使型別有交集', () => {
    const withNull = shapeOf([{ Date: '1', TAIEX: '2' }, { Date: '3', TAIEX: null }])
    const drifts = diffShape(fixture, withNull)
    expect(drifts.find(d => d.path === '[].TAIEX')?.severity).toBe('breaking')
    expect(drifts.find(d => d.path === '[].TAIEX')?.detail).toContain('null')
  })

  it('樣本本來就有 null 時，現況照樣有 null 不算漂移（反向對照）', () => {
    const nullable = shapeOf([{ Date: '1', TAIEX: '2' }, { Date: '3', TAIEX: null }])
    expect(diffShape(nullable, nullable).filter(d => d.severity === 'breaking')).toEqual([])
  })

  // 巢狀空陣列：legacy API 的 {stat, data: []}。若不特判，data 底下每個欄位都會被報成
  // 「現況沒有」——非交易日每次都誤報，這支工具很快就會被無視。
  it('現況的巢狀陣列變空時只是 info，不是欄位不見了', () => {
    const nested = shapeOf({ stat: 'OK', data: [{ a: '1', b: '2' }] })
    const emptyNow = shapeOf({ stat: 'OK', data: [] })
    const drifts = diffShape(nested, emptyNow)
    expect(drifts.filter(d => d.severity === 'breaking')).toEqual([])
    expect(drifts.find(d => d.path === '.data[].a')?.detail).toContain('空陣列')
  })

  it('現況那一層真的不見了（不是變空陣列）仍是 breaking（反向對照）', () => {
    const nested = shapeOf({ stat: 'OK', data: [{ a: '1' }] })
    const gone = shapeOf({ stat: 'OK' })
    expect(diffShape(nested, gone).some(d => d.severity === 'breaking')).toBe(true)
  })
})
