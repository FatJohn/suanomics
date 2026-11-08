import { describe, expect, it } from 'vitest'
import { hasGarbledChars } from './_garbled-text.js'

describe('hasGarbledChars', () => {
  // 真實樣本：2026-08-12 的 viewpoints A/B，with-ledger 臂產出、且通過了 compliance gate
  // 與 ViewpointsSchema。既有 stripControlChars 掃不到——這些是合法碼位的 CJK，不是控制字元。
  it('flags real garbled output observed in the 2026-08-12 A/B', () => {
    expect(hasGarbledChars('成由攥䍕挧攥萱刑甘成甥、嘐瀕外資售日買超台股達903.08億元、但川普威脅干預聯準會獨立性。')).toBe(true)
    expect(hasGarbledChars('成分嘠攢攠舐节成爲倉猱允違甘䈵划猱我別爡急酅錢儲猱䈵外資7月大舉匡出台霓股市。')).toBe(true)
  })

  it('does not flag normal Taiwanese financial prose', () => {
    expect(hasGarbledChars('此因素削弱該論點，因為台積電營收大幅成長45%且2026年資本支出升至640億美元。')).toBe(false)
    expect(hasGarbledChars('費城半導體指數於2026年8月10日降至11,994點，外資連7日賣超。')).toBe(false)
    expect(hasGarbledChars('三大法人轉為買超736億元，加權指數單日大漲1.59%。')).toBe(false)
  })

  it('does not flag empty or ascii-only text', () => {
    expect(hasGarbledChars('')).toBe(false)
    expect(hasGarbledChars('SOX 12,098 / NASDAQ COMP')).toBe(false)
  })

  // 偵測的是「幾乎不會出現在台股財經文字裡的區段」，不是「罕用字」。
  // 常用區裡的替換字（`羮債`←美債、`殛利率`←毛利率）這支抓不到，是已知下界。
  it('is a lower bound: substituted chars inside the common block are missed', () => {
    expect(hasGarbledChars('10年期羮債殖利率升至4.69%。')).toBe(false)
  })
})
