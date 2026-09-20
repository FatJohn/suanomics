import type { MarketBriefCitation, RelatedNews } from '@suanomics/shared'
import type { NewsItem } from '@/stores/brief.js'
import { describe, expect, it } from 'vitest'
import { buildBriefSources } from './brief-sources.js'

function cite(url: string, title = `t-${url}`, quote = 'q'): MarketBriefCitation {
  return { url, title, quote }
}
function rel(url: string, relationType: RelatedNews['relationType'] = 'cause'): RelatedNews {
  return { url, title: `r-${url}`, relationType, reasoning: `why-${url}` }
}
function item(url: string, publishedAt: string | null = '2026-07-31T01:00:00.000Z', id = 77): NewsItem {
  return { id, title: `i-${url}`, url, publishedAt }
}

describe('buildBriefSources', () => {
  it('把同一個 url 的三種身分合成一筆，而不是列三次', () => {
    const out = buildBriefSources([cite('https://a.example/1')], [rel('https://a.example/1')], [item('https://a.example/1')])

    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      url: 'https://a.example/1',
      quote: 'q',
      relation: { type: 'cause', reasoning: 'why-https://a.example/1' },
      publishedAt: '2026-07-31T01:00:00.000Z',
    })
  })

  it('標題以 citation 為準——那是報告實際用的說法', () => {
    const out = buildBriefSources([cite('https://a.example/1', '引用用的標題')], [rel('https://a.example/1')], [item('https://a.example/1')])

    expect(out[0]?.title).toBe('引用用的標題')
  })

  it('有明述關係的排在前面，其餘保持 citation 順序', () => {
    const out = buildBriefSources(
      [cite('https://a.example/1'), cite('https://a.example/2'), cite('https://a.example/3')],
      [rel('https://a.example/3')],
      [],
    )

    expect(out.map(s => s.url)).toEqual(['https://a.example/3', 'https://a.example/1', 'https://a.example/2'])
  })

  it('保住站內單則新聞頁的 id——那一頁有原始連結給不了的連動分析', () => {
    const out = buildBriefSources([cite('https://a.example/1')], [], [item('https://a.example/1', null, 4321)])

    expect(out[0]?.newsId).toBe(4321)
  })

  it('只被引用、沒進當日新聞清單的那些不該冒出 newsId', () => {
    const out = buildBriefSources([cite('https://a.example/1')], [rel('https://a.example/1')], [])

    expect(out[0]?.newsId).toBeUndefined()
  })

  it('relatedNews 指到 citations 沒有的 url 時也要收進來、不能整筆掉掉', () => {
    const out = buildBriefSources([cite('https://a.example/1')], [rel('https://a.example/9', 'effect')], [])

    // 有關係的排前面，所以這筆在第 0 位
    expect(out.map(s => s.url)).toEqual(['https://a.example/9', 'https://a.example/1'])
    expect(out[0]).toMatchObject({ title: 'r-https://a.example/9', relation: { type: 'effect' } })
    expect(out[0]?.quote).toBeUndefined()
  })

  it('多筆當日新聞各自帶回自己的 id，不會對錯位', () => {
    const out = buildBriefSources(
      [cite('https://a.example/1'), cite('https://a.example/2')],
      [],
      [item('https://a.example/2', null, 222), item('https://a.example/1', null, 111)],
    )

    expect(out.map(s => [s.url, s.newsId])).toEqual([['https://a.example/1', 111], ['https://a.example/2', 222]])
  })

  it('監測到但沒被引用的新聞收在最後，且標得出來沒有 quote', () => {
    const out = buildBriefSources([cite('https://a.example/1')], [], [item('https://a.example/9')])

    expect(out.map(s => s.url)).toEqual(['https://a.example/1', 'https://a.example/9'])
    expect(out[1]?.quote).toBeUndefined()
    expect(out[1]?.title).toBe('i-https://a.example/9')
  })

  it('網域去掉 www、給讀者看的是來源名不是完整網址', () => {
    const out = buildBriefSources([cite('https://www.cnbc.com/2026/07/30/x.html'), cite('https://ec.ltn.com.tw/article/1')], [], [])

    expect(out.map(s => s.domain)).toEqual(['cnbc.com', 'ec.ltn.com.tw'])
  })

  it('壞掉的 url 不讓整份清單炸掉、domain 退回原字串', () => {
    const out = buildBriefSources([cite('not-a-url')], [], [])

    expect(out).toHaveLength(1)
    expect(out[0]?.domain).toBe('not-a-url')
  })

  it('三個輸入都空時回空陣列', () => {
    expect(buildBriefSources([], [], [])).toEqual([])
  })

  it('citations 內同一個 url 出現兩次時只留一筆', () => {
    const out = buildBriefSources([cite('https://a.example/1', 'first'), cite('https://a.example/1', 'second')], [], [])

    expect(out).toHaveLength(1)
    expect(out[0]?.title).toBe('first')
  })
})
