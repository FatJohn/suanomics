import { describe, expect, it } from 'vitest'
import { hasBodyBeyondTitle } from './enrichable.js'

// fixture 是 2026-08-21 用 production fetchRssSource 抓下來的值。
//
// ★ 前一版在這裡宣稱「全是真實值」但其實不是：WHITEHOUSE 的 excerpt 尾句
//   「to modernize the regulatory framework.」是寫測試時自己補完的句子，feed 裡不存在
//   （真文是「to reinvigorate America's leadership in space transportation and enable
//     over 1,000 launches…」）。獨立複查實抓 feed 比對才發現。
//   捏造一段看起來很像的內容、再宣稱它逐字，比明說截斷還糟——下一個人不會再去查。
//
// 現在的規則：**只截斷、不補字**。逐字取前 N 字元的就在該欄註明「前 N 字元逐字」。
const GOOGLE_NEWS = {
  title: 'EXCLUSIVE: Trump administration to back US minerals projects with $500 million in grants - Reuters',
  excerpt: '<a href="https://news.google.com/rss/articles/CBMivwFBVV95cUxQdThFUDZLSTMyUHJsWGcwcS16TExSR3JHMnp1R25OQWltNmp4TGZ2R3dlbDJRQ2taWnVBODlVNXVOMUFRYmI5U3pEbHktb2xRYk5lZE00TzBqdmZqdXBzY3ZZaFVqRTdGQnhlSDdGMmpRbWpwblRkandfRmFnWUhwbUpDRmF4dk1UUVVGdmdlZGpoYWNiM1d4QUowU2x5aFhqMnM4d1E4ZEN2VVZ3LVdxYUpUQWM2bEF5dkgzSkstOA?oc=5" target="_blank">EXCLUSIVE: Trump administration to back US minerals projects with $500 million in grants</a>&nbsp;&nbsp;<font color="#6f6f6f">Reuters</font>',
}
const FED = {
  title: 'Minutes of the Federal Open Market Committee, July 28–29, 2026',
  excerpt: 'Minutes of the Federal Open Market Committee, July 28–29, 2026',
}
// 逐字（含開頭三個換行，那是該 feed 的實際形狀）。
const LIBERTY = {
  title: '證交所「公布注意暨處置專區」正式上線 便利投資人一站式查詢',
  excerpt: '\n\n\n臺灣證券交易所繼今年8月10日實施公布注意及處置新規定後，為強化相關資訊揭露，提升投資人查詢之便利性，於8月21日推出「公布注意暨處置專區」，提供投資人更便捷的一站式查詢...…',
}
// excerpt 為實際值（782 字元）的前 230 字元逐字，未補任何字。
const WHITEHOUSE = {
  title: 'Fact Sheet: President Donald J. Trump Launches the Golden Age of Space Transportation',
  excerpt: '<p>RENEWING AMERICAN SPACE TRANSPORTATION LEADERSHIP:&#160;Today, President Donald J. Trump signed a National Security Presidential Memorandum to reinvigorate America\u2019s leadership in space transportation and enable over 1,000 laun',
}

describe('hasBodyBeyondTitle', () => {
  it('google News 代理：錨點 markup 剝掉之後只剩標題與發行商名 → 沒有本文', () => {
    expect(hasBodyBeyondTitle(GOOGLE_NEWS.title, GOOGLE_NEWS.excerpt)).toBe(false)
  })

  it('fed press_monetary：description 逐字等於 title → 沒有本文', () => {
    expect(hasBodyBeyondTitle(FED.title, FED.excerpt)).toBe(false)
  })

  it('自由財經：description 是真的內文開頭 → 有本文', () => {
    expect(hasBodyBeyondTitle(LIBERTY.title, LIBERTY.excerpt)).toBe(true)
  })

  it('白宮官方 feed：帶 <p> 標籤但內容是完整段落 → 有本文', () => {
    expect(hasBodyBeyondTitle(WHITEHOUSE.title, WHITEHOUSE.excerpt)).toBe(true)
  })

  it('空字串／只有空白／null／undefined 一律沒有本文', () => {
    expect(hasBodyBeyondTitle('some title', '')).toBe(false)
    expect(hasBodyBeyondTitle('some title', '   \n  ')).toBe(false)
    expect(hasBodyBeyondTitle('some title', null)).toBe(false)
    expect(hasBodyBeyondTitle('some title', undefined)).toBe(false)
  })

  it('只有 HTML 標籤、剝掉後沒有文字 → 沒有本文', () => {
    expect(hasBodyBeyondTitle('some title', '<p></p><br/>&nbsp;')).toBe(false)
  })

  it('excerpt 是 title 的子字串（沒有新資訊）→ 沒有本文', () => {
    expect(hasBodyBeyondTitle('台積電法說會重點整理', '台積電法說會')).toBe(false)
  })

  it('★ 判定只看資訊量、不看標點與大小寫差異', () => {
    // Google News 的 title 是「… - Reuters」而 excerpt 剝完是「…  Reuters」，
    // 差別只在分隔符。若比較時不把標點與空白正規化掉，這一組會被誤判成有本文。
    expect(hasBodyBeyondTitle('A B C - Reuters', 'a, b. c — reuters!')).toBe(false)
  })

  it('比 title 多出實質內容就算有本文（保守：只有完全沒有新資訊才擋）', () => {
    expect(hasBodyBeyondTitle('央行升息一碼', '央行升息一碼，理由是通膨壓力未解。')).toBe(true)
  })
})
