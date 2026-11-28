import { describe, expect, it } from 'vitest'
import { headlinePhrases } from './headline'

const H1127 = '台股單日重挫4.8%：外資流出、AI股承壓、升息預期與能源通膨同時進入市場定價'
const PUNCT = /^[，、。：；！？）」』】》〉%]/

describe('headlinePhrases', () => {
  it('依全形標點切成片語，標點黏在前一個片語', () => {
    expect(headlinePhrases(H1127).map(p => p.join(''))).toEqual([
      '台股單日重挫4.8%：',
      '外資流出、',
      'AI股承壓、',
      '升息預期與能源通膨同時進入市場定價',
    ])
  })

  it('開括號與引號黏在後一個片語，連續標點不拆開', () => {
    expect(headlinePhrases('美擬課越南「最高35%」，稅率待定').map(p => p.join(''))).toEqual(['美擬課越南', '「最高35%」，', '稅率待定'])
  })

  it('半形空白不切片語', () => {
    expect(headlinePhrases('費半單日重挫 7.88%：AI 權值股回吐').map(p => p.join(''))).toEqual(['費半單日重挫 7.88%：', 'AI 權值股回吐'])
  })

  it('片語內只在兩個多字詞之間留斷點，不拆開詞', () => {
    const last = headlinePhrases(H1127).at(-1) ?? []
    expect(last.length).toBeGreaterThan(1)
    const boundaries = new Set<number>()
    let at = 0
    for (const chunk of last.slice(0, -1)) {
      at += chunk.length
      boundaries.add(at)
    }
    const phrase = last.join('')
    for (const word of ['升息', '預期', '能源', '通膨', '同時', '進入', '市場', '定價']) {
      const start = phrase.indexOf(word)
      for (let k = start + 1; k < start + word.length; k++)
        expect(boundaries.has(k), `${word} 被拆開`).toBe(false)
    }
  })

  it('單字詞不當斷點：「台股」「承壓」不會被拆成兩塊', () => {
    const chunks = headlinePhrases(H1127).flat()
    expect(chunks.some(c => c.endsWith('台') || c.startsWith('股'))).toBe(false)
    expect(chunks.some(c => c.endsWith('承') || c.startsWith('壓'))).toBe(false)
  })

  it('沒有任何片語或斷塊以標點開頭', () => {
    for (const title of [H1127, '輝達換回黃仁勳帶動台指期夜盤急彈，現貨資金面與外資期貨部位仍未確認', '美擬課越南「最高35%」，稅率待定'])
      expect(headlinePhrases(title).flat().filter(c => PUNCT.test(c))).toEqual([])
  })

  it('接起來等於原標題', () => {
    expect(headlinePhrases(H1127).flat().join('')).toBe(H1127)
  })

  it('空標題回傳空陣列', () => {
    expect(headlinePhrases('')).toEqual([])
  })
})
