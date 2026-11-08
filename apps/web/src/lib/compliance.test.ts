import { describe, expect, it } from 'vitest'
import { redactBlockedSentences } from './compliance'

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

  it('個股與方向詞跨句靠近時，整段不顯示', () => {
    expect(redactBlockedSentences('台積電法說會在週四。市場加碼')).toBe('')
  })
})
