import { describe, expect, it } from 'vitest'
import { redactBlockedMarkdown, redactBlockedSentences } from './compliance'

describe('redactBlockedSentences', () => {
  it('只拿掉命中禁用語的句子', () => {
    expect(redactBlockedSentences('油價上漲。建議買進台積電。匯率持平。')).toBe('油價上漲。匯率持平。')
  })

  it('沒有命中時原樣保留', () => {
    expect(redactBlockedSentences('外資賣超。\n\n央行維持利率。')).toBe('外資賣超。\n\n央行維持利率。')
  })

  it('markdown 標記拆開禁用語也攔得到', () => {
    expect(redactBlockedSentences('油價上漲。建議**買**進。')).toBe('油價上漲。')
  })

  it('換行拆開禁用語時，從尾端丟句直到整段通過', () => {
    expect(redactBlockedSentences('建\n議買進')).toBe('建\n')
  })

  it('個股與方向詞跨句靠近時，從尾端丟句而不是清空整段', () => {
    expect(redactBlockedSentences('台積電法說會在週四。市場加碼')).toBe('台積電法說會在週四。')
  })

  it('整段通過時原樣保留', () => {
    expect(redactBlockedSentences('外資賣超。投信加碼台積電。')).toBe('外資賣超。投信加碼台積電。')
  })

  it('前一句的主詞不替後句的方向詞背書，刪掉後句（#73）', () => {
    expect(redactBlockedSentences('外資。加碼台積電。')).toBe('外資。')
  })

  it('空行分段時，前一段的主詞不替後一段的方向詞背書（#76）', () => {
    expect(redactBlockedSentences('外資\n\n加碼台積電')).toBe('外資\n\n')
  })

  it('只含空白的行也算分段（#76）', () => {
    expect(redactBlockedSentences('外資\n \n加碼台積電')).toBe('外資\n \n')
  })

  it('整段只有單一換行時，渲染後仍在同一段，同句歸因照常放行（#76）', () => {
    expect(redactBlockedSentences('外資\n加碼台積電')).toBe('外資\n加碼台積電')
  })

  it('markdown 把單獨的 \\r 當換行，連續兩個 \\r 也算分段（#76）', () => {
    expect(redactBlockedSentences('外資\r\r加碼台積電')).toBe('')
  })

  it('只含全形空白的行在 markdown 不算空行，同句歸因照常放行（#76）', () => {
    expect(redactBlockedSentences('外資\n　\n加碼台積電')).toBe('外資\n　\n加碼台積電')
  })

  it('換行拆開公司名時，個股與方向詞仍被攔下（#76）', () => {
    expect(redactBlockedSentences('台積\n電看多')).toBe('台積\n')
    expect(redactBlockedSentences('台積\n電加碼')).toBe('台積\n')
    expect(redactBlockedSentences('台積\n\n電加碼')).toBe('台積\n\n')
  })
})

describe('redactBlockedMarkdown', () => {
  it('刪句拆散強調標記時拿掉殘留的標記，不留字面 ** 或誤開粗體', () => {
    expect(redactBlockedMarkdown('**建議買進。**外資賣超，**匯率**持平。')).toBe('外資賣超，匯率持平。')
  })

  it('夾在英數字中間的 _ 不是強調標記，刪句後保留', () => {
    expect(redactBlockedMarkdown('建議買進。US_10Y 殖利率上升，_匯率_持平。')).toBe('US_10Y 殖利率上升，匯率持平。')
  })

  it('沒有刪句時保留強調標記', () => {
    expect(redactBlockedMarkdown('**外資**賣超。')).toBe('**外資**賣超。')
  })
})
