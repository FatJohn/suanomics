import { describe, expect, it } from 'vitest'
import { BODY_FETCH_DENIED_HOSTS, isBodyFetchDenied } from './body-fetch-policy.js'

describe('isBodyFetchDenied', () => {
  it('被拒的 host 本身與其子網域都算', () => {
    expect(isBodyFetchDenied('https://ctee.com.tw/news/policy/1')).toBe(true)
    expect(isBodyFetchDenied('https://www.ctee.com.tw/news/policy/1')).toBe(true)
  })

  // ★ 這條擋的是 `endsWith` 的經典誤判：`notctee.com.tw` 結尾也是 `ctee.com.tw`。
  it('只是結尾長得像的 host 不算', () => {
    expect(isBodyFetchDenied('https://notctee.com.tw/x')).toBe(false)
    expect(isBodyFetchDenied('https://evil-ctee.com.tw/x')).toBe(false)
  })

  it('沒被拒的 host 照常抓', () => {
    expect(isBodyFetchDenied('https://tw.stock.yahoo.com/news/x.html')).toBe(false)
    expect(isBodyFetchDenied('https://news.cnyes.com/news/id/1')).toBe(false)
  })

  it('解析不了的網址回 false，不拋例外', () => {
    expect(isBodyFetchDenied('not a url')).toBe(false)
  })
})

describe('body-fetch 拒抓清單', () => {
  // 這份清單是政策決定的落點，改動它等於改一個使用者拍過板的決定。釘住現況讓那件事
  // 必須是刻意的：加一個 host 會讓這條紅，改的人就得回來讀上面那段理由。
  it('目前只有 ctee 一家（2026-09-07 拍板）', () => {
    expect([...BODY_FETCH_DENIED_HOSTS]).toEqual(['ctee.com.tw'])
  })
})
