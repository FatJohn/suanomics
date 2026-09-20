import { describe, expect, it } from 'vitest'
import { ALIAS_GROUPS, normLenient, normStrict, normTag } from './normalize.js'

// 這份測試釘住的是「重疊率可不可信」的底層規則。
// 正規化放寬一點、兩臂看起來就會更像；收緊一點、就會憑空長出分歧。
// 所以規則改動必須先在這裡改斷言、而不是改完 normalize.ts 才發現指標動了。

describe('normStrict：只收斂「同一字串的不同寫法」、不做語意判斷', () => {
  it('全形經 NFKC 攤成半形', () => {
    expect(normStrict('ＮＶＩＤＩＡ')).toBe(normStrict('NVIDIA'))
    expect(normStrict('ＴＳＭＣ')).toBe('tsmc')
  })

  it('大小寫不算分歧', () => {
    expect(normStrict('Nvidia')).toBe('nvidia')
    expect(normStrict('FED')).toBe(normStrict('fed'))
  })

  it('去掉成對括號內容（半形 / 全形 / 方括號 / 黑括號）', () => {
    expect(normStrict('台積電(2330)')).toBe('台積電')
    expect(normStrict('台積電（2330）')).toBe('台積電')
    expect(normStrict('Nvidia（輝達）')).toBe('nvidia')
    expect(normStrict('聯準會【Fed】')).toBe('聯準會')
    expect(normStrict('Fed [FOMC]')).toBe('fed')
  })

  it('去掉空白與常見中英標點（分詞差異不該算成分歧）', () => {
    expect(normStrict('S&P 500')).toBe('sp500')
    expect(normStrict('費城　半導體・指數')).toBe('費城半導體指數')
    expect(normStrict('台積電 ADR')).toBe(normStrict('台積電ADR'))
  })

  it('未成對的括號不觸發整段吃掉（免得把後半截名字吞了）', () => {
    expect(normStrict('台積電(2330')).toBe('台積電(2330')
  })

  it('去括號之後仍是不同的名字就維持不同（不做語意合併）', () => {
    expect(normStrict('台積電ADR')).not.toBe(normStrict('台積電'))
  })
})

describe('normLenient：strict 之後再套一張明列的中英 / 俗名對照表', () => {
  it('中英別名折成同一個 canonical', () => {
    expect(normLenient('台積電')).toBe(normLenient('TSMC'))
    expect(normLenient('輝達')).toBe(normLenient('NVIDIA'))
    expect(normLenient('聯準會')).toBe(normLenient('Federal Reserve'))
    expect(normLenient('費半')).toBe(normLenient('費城半導體指數'))
  })

  it('括號寫法先被 strict 收斂、再查表', () => {
    expect(normLenient('台積電(2330)')).toBe('tsmc')
    expect(normLenient('Nvidia（輝達）')).toBe('nvidia')
  })

  it('不收上下位詞：晶片與半導體不折成同一個', () => {
    expect(normLenient('晶片')).not.toBe(normLenient('半導體'))
  })

  it('表外的字串原樣落回 strict 結果', () => {
    expect(normLenient('Kimi K3')).toBe('kimik3')
    expect(normLenient('Helios')).toBe('helios')
  })

  it('對照表沒有一個別名被指到兩個 canonical（有的話重疊率會隨表的順序漂移）', () => {
    const seen = new Map<string, string>()
    for (const [canonical, names] of Object.entries(ALIAS_GROUPS)) {
      for (const n of names) {
        const key = normStrict(n)
        expect(seen.get(key) ?? canonical).toBe(canonical)
        seen.set(key, canonical)
      }
    }
  })

  it('每個 canonical key 自己也是合法的 strict 形式（查表結果餵回去要穩定）', () => {
    for (const canonical of Object.keys(ALIAS_GROUPS))
      expect(normStrict(canonical)).toBe(canonical)
  })
})

describe('normTag：topicTags 的正規化（kebab-case）', () => {
  it('小寫、空白與底線統一成 hyphen', () => {
    expect(normTag('AI_Chips')).toBe('ai-chips')
    expect(normTag(' Fed Rate ')).toBe('fed-rate')
  })

  it('不做別名折疊（tag 是封閉詞彙、不該套 entity 的對照表）', () => {
    expect(normTag('台積電')).toBe('台積電')
  })
})
