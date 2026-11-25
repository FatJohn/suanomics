import { describe, expect, it } from 'vitest'
import { mergeQualitySources } from './quality-facts.js'

const news = (id: number, url: string, contentText: string | null = null) => ({ id, title: `n${id}`, url, contentText })

describe('mergeQualitySources', () => {
  it('news_items 依 id 去重，沒有內文時用標題', () => {
    expect(mergeQualitySources([news(1, 'https://a/1'), news(1, 'https://a/1')], [])).toEqual([
      { title: 'n1', url: 'https://a/1', text: 'n1' },
    ])
  })

  // 連動鏈引用的 corpus 文章不在 news_items：少了這一段，judge 會把那些數字與事件判成虛構，
  // 有 corpus 的 brief 在 A/B 裡被系統性扣分。
  it('引用到的 corpus 文章併進底本', () => {
    const corpus = [{ id: 'u1', title: '央行理監事會決議', url: 'https://cbc/1', text: '央行維持利率不變' }]
    expect(mergeQualitySources([news(1, 'https://a/1', '內文')], corpus)).toEqual([
      { title: 'n1', url: 'https://a/1', text: '內文' },
      { title: '央行理監事會決議', url: 'https://cbc/1', text: '央行維持利率不變' },
    ])
  })

  it('同一個 url 已在 news_items 時不重複列', () => {
    const corpus = [{ id: 'u1', title: 'dup', url: 'https://a/1', text: 'dup' }]
    expect(mergeQualitySources([news(1, 'https://a/1')], corpus)).toHaveLength(1)
  })
})
