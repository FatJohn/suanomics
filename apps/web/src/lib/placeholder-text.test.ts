import { describe, expect, it } from 'vitest'
import { isPlaceholderText } from './placeholder-text'

// 判準：整段去掉前後空白、外層括號與句末標點後，剩下的是空字串、只有標點，
// 或整段等於下列佔位詞之一（英文不分大小寫）。只比對整段，句子裡提到這些詞不算。
describe('isPlaceholderText 判為 placeholder', () => {
  it.each([
    ['placeholder'], // #124 production 實際出現的字串
    ['Placeholder'],
    ['PLACEHOLDER.'],
    ['<placeholder>'],
    ['[placeholder]'],
    ['{placeholder}'],
    ['（placeholder）'],
    ['"placeholder"'],
    ['TBD'],
    ['TODO'],
    ['N/A'],
    ['n/a'],
    ['null'],
    ['undefined'],
    ['none'],
    ['lorem ipsum'],
    ['reasoning'],
    ['待補'],
    ['待補充'],
    ['待填'],
    ['略'],
    ['（略）'],
    ['無'],
    ['理由'],
    ['NA'],
    ['n.a.'],
    ['nil'],
    ['TBA'],
    ['string'],
    ['xxx'],
    ['placeholder text'],
    ['Lorem ipsum dolor sit amet'],
    ['暫無'],
    ['尚無'],
    ['無資料'],
    ['待確認'],
    ['未提供'],
    ['同上'],
    ['空'],
    ['缺'],
  ])('%s', (s) => {
    expect(isPlaceholderText(s)).toBe(true)
  })

  it.each([
    ['ｐｌａｃｅｈｏｌｄｅｒ'],
    ['N／A'],
    ['Ｎ/Ａ'],
    ['lorem  ipsum'],
    ['​'],
    ['​placeholder⁠'],
  ])('全形、內部多餘空白或不可見字元的寫法：%j', (s) => {
    expect(isPlaceholderText(s)).toBe(true)
  })

  it.each([
    [''],
    ['   '],
    ['\n\t'],
    ['...'],
    ['…'],
    ['——'],
    ['-'],
    ['。'],
  ])('空白或只有標點：%j', (s) => {
    expect(isPlaceholderText(s)).toBe(true)
  })
})

describe('isPlaceholderText 正向語料不誤擋', () => {
  it.each([
    ['費半重挫。'],
    ['油價上漲。'],
    ['美債殖利率走升，壓抑高本益比電子股評價；台積電 ADR 同步下跌。'],
    ['Fed 維持利率不變，市場關注 12 月點陣圖，金融股利差預期持穩。'],
    ['NVIDIA 財報優於預期，帶動 AI 伺服器供應鏈。'],
    ['無人機需求升溫，帶動相關零組件出貨。'],
    ['略為受惠於匯率走貶。'],
    ['TBD 的關稅細節仍待美方公告，航運業運價走勢不明。'],
    ['理由見詳解 2：電價調漲推升製造成本。'],
    ['N/A 系列指數今日未公布，改以前一交易日收盤估算。'],
    ['這不是 placeholder，而是電機機械因自動化需求上修的說明。'],
    ['None of the above applies.'],
    ['無影響。'],
    ['無明顯影響。'],
    ['略升。'],
    ['暫無明確利多，但評價已反映。'],
    ['空頭回補帶動反彈。'],
    ['缺料緩解，出貨回升。'],
    ['同上游報價走揚，成本轉嫁順利。'],
    ['AI'],
    ['5G'],
    ['承壓'],
    ['null pointer 事件衝擊資安股'],
  ])('%s', (s) => {
    expect(isPlaceholderText(s)).toBe(false)
  })
})
