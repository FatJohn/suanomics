import { describe, expect, it } from 'vitest'
import { renderMarkdown } from './markdown'

describe('renderMarkdown', () => {
  it('保留段落與粗體', () => {
    expect(renderMarkdown('第一段\n\n**第二**段')).toBe('<p>第一段</p>\n<p><strong>第二</strong>段</p>\n')
  })

  it('連結不成為 href，避免拼出禁用語或帶出非 http(s) scheme', () => {
    const html = renderMarkdown('甲[買](ftp://evil.example/a)乙 <mailto:a@evil.example> ftp://evil.example/b')
    expect(html).not.toContain('href')
  })

  it('hTML entity 不解碼', () => {
    expect(renderMarkdown('建議&#36023;進')).not.toContain('買')
  })

  it('圖片不輸出，避免讀者瀏覽器連到第三方', () => {
    expect(renderMarkdown('![x](https://tracker.example/p.png)')).not.toContain('<img')
  })
})
