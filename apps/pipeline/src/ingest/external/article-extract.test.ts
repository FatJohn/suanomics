import { describe, expect, it } from 'vitest'
import { extractReadableText } from './article-extract.js'

const longParagraph = '半導體供應鏈的資本支出在第三季持續上修，市場關注先進封裝產能的擴張速度與客戶需求的變化，'.repeat(6)

describe('extractReadableText', () => {
  it('取出文章本體，排除導覽與側欄', () => {
    const html = `<html><head><title>標題</title></head><body><nav><p>導覽連結文字導覽連結文字導覽連結文字</p></nav>
      <article><h1>標題</h1><p>${longParagraph}</p><p>${longParagraph}</p></article>
      <aside><p>熱門文章側欄熱門文章側欄</p></aside></body></html>`
    const text = extractReadableText(html)
    expect(text).toContain('先進封裝')
    expect(text).not.toContain('導覽連結')
    expect(text).not.toContain('熱門文章側欄')
  })
  it('段落之間保留換行', () => {
    const html = `<html><body><article><p>${longParagraph}第一段</p><p>${longParagraph}第二段</p></article></body></html>`
    expect(extractReadableText(html)).toMatch(/第一段\n/)
  })
  it('readability 判不出文章時退回段落抽取', () => {
    const html = '<html><body><p>這是一段長度足夠通過最低字數門檻的短篇公告內容，共有三十個字以上。</p></body></html>'
    expect(extractReadableText(html)).toContain('短篇公告')
  })
  it('沒有內容時回 null', () => {
    expect(extractReadableText('<html><body><div></div></body></html>')).toBeNull()
  })
})
