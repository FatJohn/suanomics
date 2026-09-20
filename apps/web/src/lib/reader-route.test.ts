import { describe, expect, it } from 'vitest'
import { resolveReaderRouteRedirect } from './reader-route.js'

describe('resolveReaderRouteRedirect', () => {
  it('沒有 date query 時不動', () => {
    expect(resolveReaderRouteRedirect({ name: 'home', path: '/', query: {} })).toBeNull()
    expect(resolveReaderRouteRedirect({ name: 'home-dated', path: '/d/2026-09-01', query: { view: 'evidence' } })).toBeNull()
  })

  it('合法日期導到 canonical 的 /d/:date', () => {
    expect(resolveReaderRouteRedirect({ name: 'home', path: '/', query: { date: '2026-09-01' } }))
      .toEqual({ path: '/d/2026-09-01', query: {} })
  })

  it('保留其他 query（例如層別），只拿掉 date', () => {
    expect(resolveReaderRouteRedirect({ name: 'home', path: '/', query: { date: '2026-09-01', view: 'evidence' } }))
      .toEqual({ path: '/d/2026-09-01', query: { view: 'evidence' } })
  })

  // ★ 不合法就只是把 key 拿掉：留著它就是留著那個「看起來有效」的錯覺
  it('不合法的日期只拿掉 date、路徑不變', () => {
    expect(resolveReaderRouteRedirect({ name: 'home', path: '/', query: { date: 'yesterday', view: 'evidence' } }))
      .toEqual({ path: '/', query: { view: 'evidence' } })
    expect(resolveReaderRouteRedirect({ name: 'home-dated', path: '/d/2026-09-01', query: { date: '2026-9-1' } }))
      .toEqual({ path: '/d/2026-09-01', query: {} })
  })

  // vue-router 對重複 key 會給陣列；`?date=`（有等號沒值）給空字串、`?date`（連等號都沒有）給 null
  it('陣列取第一個、null 當不合法處理', () => {
    expect(resolveReaderRouteRedirect({ name: 'home', path: '/', query: { date: ['2026-09-01', '2026-08-31'] } }))
      .toEqual({ path: '/d/2026-09-01', query: {} })
    expect(resolveReaderRouteRedirect({ name: 'home', path: '/', query: { date: null } }))
      .toEqual({ path: '/', query: {} })
  })

  // ★ `?view=` 的非法值同樣是「看起來有效、實際沒作用」：resolveReaderLayer 把 evidence
  //   以外一律當報告層，而 layerQuery 刻意不留 ?view=report，所以它們只會停在網址上。
  it('非法或多餘的 view 被拿掉', () => {
    expect(resolveReaderRouteRedirect({ name: 'home-dated', path: '/d/2026-09-01', query: { view: 'bogus' } }))
      .toEqual({ path: '/d/2026-09-01', query: {} })
    expect(resolveReaderRouteRedirect({ name: 'home', path: '/', query: { view: 'report' } }))
      .toEqual({ path: '/', query: {} })
    expect(resolveReaderRouteRedirect({ name: 'home', path: '/', query: { view: '' } }))
      .toEqual({ path: '/', query: {} })
    // `?view`（連等號都沒有）：vue-router 給 null，和 `?date` 同一個形狀。
    // 少了這條斷言，「把 null 當成已正規化」的寫法會全綠——驗收用突變抓到過。
    expect(resolveReaderRouteRedirect({ name: 'home', path: '/', query: { view: null } }))
      .toEqual({ path: '/', query: {} })
  })

  // ★ 負向對照：合法的 view 不能被動到，否則每次進佐證層都會多一次 replace
  it('view=evidence 不動', () => {
    expect(resolveReaderRouteRedirect({ name: 'home-dated', path: '/d/2026-09-01', query: { view: 'evidence' } })).toBeNull()
  })

  it('重複的 view key 收斂成單一值', () => {
    expect(resolveReaderRouteRedirect({ name: 'home', path: '/', query: { view: ['evidence', 'report'] } }))
      .toEqual({ path: '/', query: { view: 'evidence' } })
  })

  // ★ 完全未知的參數不碰：我們沒有立場宣稱懂它（未來的 UTM／?ref= 就是這類）
  it('未知的 query 原樣留著、也不會自己觸發導覽', () => {
    expect(resolveReaderRouteRedirect({ name: 'home', path: '/', query: { foo: 'bar' } })).toBeNull()
    expect(resolveReaderRouteRedirect({ name: 'home', path: '/', query: { date: '2026-09-01', foo: 'bar' } }))
      .toEqual({ path: '/d/2026-09-01', query: { foo: 'bar' } })
    expect(resolveReaderRouteRedirect({ name: 'home', path: '/', query: { view: 'bogus', foo: 'bar' } }))
      .toEqual({ path: '/', query: { foo: 'bar' } })
  })

  it('date 與 view 同時要處理時只導一次', () => {
    expect(resolveReaderRouteRedirect({ name: 'home', path: '/', query: { date: '2026-09-01', view: 'bogus' } }))
      .toEqual({ path: '/d/2026-09-01', query: {} })
    expect(resolveReaderRouteRedirect({ name: 'home', path: '/', query: { date: '2026-09-01', view: 'evidence' } }))
      .toEqual({ path: '/d/2026-09-01', query: { view: 'evidence' } })
  })

  // ★ 負向對照：其他頁面的 query 不歸這裡管，別把 /sources?date= 也吃掉
  it('非讀者面路由一律不動', () => {
    expect(resolveReaderRouteRedirect({ name: 'sources', path: '/sources', query: { date: '2026-09-01' } })).toBeNull()
    expect(resolveReaderRouteRedirect({ name: undefined, path: '/whatever', query: { date: '2026-09-01' } })).toBeNull()
    expect(resolveReaderRouteRedirect({ name: 'sources', path: '/sources', query: { view: 'bogus' } })).toBeNull()
  })
})
