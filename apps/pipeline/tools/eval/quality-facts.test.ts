import { describe, expect, it } from 'vitest'
import { mergeQualitySources } from './quality-facts.js'

const news = (id: number, url: string, contentText: string | null = null) => ({ id, title: `n${id}`, url, contentText })

describe('mergeQualitySources', () => {
  it('news_items 依 id 去重，沒有內文時用標題', () => {
    expect(mergeQualitySources([news(1, 'https://a/1'), news(1, 'https://a/1')])).toEqual([
      { title: 'n1', url: 'https://a/1', text: 'n1' },
    ])
  })
})
