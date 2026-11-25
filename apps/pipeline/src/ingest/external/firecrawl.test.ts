import { describe, expect, it } from 'vitest'
import { firecrawlMarkdown } from './firecrawl.js'

// 形狀取自官方文件 docs.firecrawl.dev/api-reference/endpoint/scrape（2026-11-08 查），本機沒有 key、未對真 API 跑過。
describe('firecrawlMarkdown', () => {
  it('取 data.markdown', () => {
    expect(firecrawlMarkdown({ success: true, data: { markdown: ' 內文 ', metadata: {} } })).toBe('內文')
  })
  it('失敗或沒有內容回 null', () => {
    expect(firecrawlMarkdown({ success: false })).toBeNull()
    expect(firecrawlMarkdown({ success: true, data: { markdown: '  ' } })).toBeNull()
    expect(firecrawlMarkdown(null)).toBeNull()
  })
})
