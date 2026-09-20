import { describe, expect, it } from 'vitest'
import { hasInternalHistory, shouldInterceptClick } from './back-link.js'

describe('hasInternalHistory', () => {
  it('站內導覽過來時 vue-router 會寫下上一筆的 fullPath', () => {
    expect(hasInternalHistory({ back: '/d/2026-09-01?view=evidence' })).toBe(true)
    expect(hasInternalHistory({ back: '/' })).toBe(true)
  })

  // ★ 直接從外部連結開啟這一頁：沒有上一頁可回，呼叫端要走 fallback
  it('直接進站時 back 是 null', () => {
    expect(hasInternalHistory({ back: null })).toBe(false)
    expect(hasInternalHistory({})).toBe(false)
    expect(hasInternalHistory(null)).toBe(false)
    expect(hasInternalHistory(undefined)).toBe(false)
  })

  // ★ 負向對照：history.state 是瀏覽器可寫的，不能拿它當成信任來源
  it('不接受站外或 protocol-relative 的值', () => {
    expect(hasInternalHistory({ back: 'https://evil.com' })).toBe(false)
    expect(hasInternalHistory({ back: '//evil.com' })).toBe(false)
    expect(hasInternalHistory({ back: 42 })).toBe(false)
  })
})

describe('shouldInterceptClick', () => {
  const plain = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false }

  it('單純左鍵才攔截', () => {
    expect(shouldInterceptClick(plain)).toBe(true)
  })

  // ★ 負向對照：開新分頁／新視窗的手勢要維持瀏覽器預設，否則讀者中鍵點下去什麼都不會發生
  it('中鍵與修飾鍵維持瀏覽器預設', () => {
    expect(shouldInterceptClick({ ...plain, button: 1 })).toBe(false)
    expect(shouldInterceptClick({ ...plain, metaKey: true })).toBe(false)
    expect(shouldInterceptClick({ ...plain, ctrlKey: true })).toBe(false)
    expect(shouldInterceptClick({ ...plain, shiftKey: true })).toBe(false)
    expect(shouldInterceptClick({ ...plain, altKey: true })).toBe(false)
  })
})
