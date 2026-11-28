import { describe, expect, it } from 'vitest'
import { splitThesis } from './thesis'

describe('splitThesis', () => {
  it('螢光筆只劃到第一個全形冒號為止，冒號與其後歸墨字', () => {
    expect(splitThesis('台股反彈缺乏資金確認：外資台指期淨空仍逾10.6萬口。後面還有一句。')).toEqual({
      highlight: '台股反彈缺乏資金確認',
      rest: '：外資台指期淨空仍逾10.6萬口。後面還有一句。',
    })
  })

  it('句號比冒號先出現時劃到第一個句號', () => {
    expect(splitThesis('利率壓住估值。外資：仍賣超')).toEqual({ highlight: '利率壓住估值', rest: '。外資：仍賣超' })
  })

  it('沒有冒號也沒有句號時整句都劃', () => {
    expect(splitThesis('利率與政策風險主導定價')).toEqual({ highlight: '利率與政策風險主導定價', rest: '' })
  })

  it('整句很短、只在句尾有句號時，劃到句號前', () => {
    expect(splitThesis('台股反彈。')).toEqual({ highlight: '台股反彈', rest: '。' })
  })

  it('半形冒號與小數點不算分句', () => {
    expect(splitThesis('台股跌4.8%:外資流出')).toEqual({ highlight: '台股跌4.8%:外資流出', rest: '' })
  })

  it('開頭就是冒號時不切，整句都劃，避免螢光筆空白', () => {
    expect(splitThesis('：外資流出')).toEqual({ highlight: '：外資流出', rest: '' })
  })

  it('引號或括號裡的冒號句號不算分句', () => {
    expect(splitThesis('「降息：延後」壓住估值：外資仍賣超')).toEqual({ highlight: '「降息：延後」壓住估值', rest: '：外資仍賣超' })
    expect(splitThesis('利率（年增。前值）偏高')).toEqual({ highlight: '利率（年增。前值）偏高', rest: '' })
  })

  it('主軸為空時兩段都是空字串', () => {
    expect(splitThesis('')).toEqual({ highlight: '', rest: '' })
  })
})
