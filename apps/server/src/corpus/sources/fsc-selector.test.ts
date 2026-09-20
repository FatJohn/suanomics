import { readFileSync } from 'node:fs'
import { EXTERNAL_SOURCES_SEED } from '@suanomics/db/seed-external-sources'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchHtmlSelector } from './html-selector.js'

// 真實擷取的 fsc.gov.tw 新聞稿列表區塊（出處與裁切範圍見 __fixtures__/manifest.ts）。
//
// ★ 這支測試是經 @suanomics/db 的 **dist** 讀 seed 的（package.json 的 exports 指 ./dist/...）。
//   只改 packages/db/src 而沒 build 時，它驗的是上一次 build 的舊值。CI 會先跑 build 所以
//   安全，本機要自己記得 `pnpm --filter @suanomics/db run build`——而且 tsc 是 incremental，
//   只動 dist 沒動 src 的話 build 不會重新產生檔案，還原時特別容易被騙。
const fixture = readFileSync(new URL('./__fixtures__/fsc-newslist-sample.html', import.meta.url), 'utf-8')
const viewFixture = readFileSync(new URL('./__fixtures__/fsc-newsview-sample.html', import.meta.url), 'utf-8')

interface HtmlSelectorSeedConfig {
  listingUrl: string
  itemSelector: string
  titleSelector: string
  linkSelector: string
  dateSelector: string
  bodySelector?: string | null
}

// selector 一律從 seed 讀、不在這支測試裡另寫一份：要釘的就是「seed 那組 selector 對真實
// 頁面有效」。在測試裡重寫一份等於拿自己的 pattern 驗自己，seed 被改壞了也不會紅。
function fscSeedConfig(): HtmlSelectorSeedConfig {
  const seed = EXTERNAL_SOURCES_SEED.find(s => s.slug === 'fsc-news')
  if (!seed)
    throw new Error('seed 裡找不到 fsc-news')
  return seed.config as HtmlSelectorSeedConfig
}

describe('fsc-news 的 seed selector', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn(async () => new Response(fixture, { status: 200 })) as never
  })

  it('對真實列表頁解析出文章', async () => {
    const entries = await fetchHtmlSelector(fscSeedConfig())
    // fixture 區塊內有 16 個 li，第一個是表頭列（role=columnheader、span.title 裡沒有 a、
    // 也沒有 href），fetchHtmlSelector 抓不到 title/link 就跳過——15 是扣掉表頭的資料列數。
    // ★ 這是 fixture 內的筆數，不是對 fsc.gov.tw 當下頁面筆數的宣稱。
    expect(entries).toHaveLength(15)
    for (const e of entries) {
      expect(e.title.length).toBeGreaterThan(0)
      expect(e.url).toMatch(/^https:\/\/www\.fsc\.gov\.tw\/ch\/home\.jsp\?.*news_view\.jsp/)
      expect(e.publishedAt).toBeInstanceOf(Date)
    }
  })

  // 這條釘的不是解析器，是 fixture 本身的鑑別力：如果它對「對的 selector」與「錯一層的
  // selector」給出同樣的結果，上面那條測試就算全綠也證明不了任何事。
  // 'ul.newslist > li' 正是 2026-08-22 之前 seed 裡的寫法（class 掛在 div 上），它讓這個
  // 來源從上線起零產出、而且沒有任何測試會紅。
  it('錯一層的舊寫法對同一份 HTML 解析出 0 筆', async () => {
    const entries = await fetchHtmlSelector({ ...fscSeedConfig(), itemSelector: 'ul.newslist > li' })
    expect(entries).toHaveLength(0)
  })
})

// 文章頁那一半。列表頁只給標題與網址，正文要另外一次請求才拿得到——沒有這一步，
// 這個來源抓回來的每一篇都是 excerpt=null、不會被 enrich，在 retriever 裡不可達。
describe('fsc-news 的 seed bodySelector', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn(async (input: unknown) => {
      const url = String(input)
      // 文章頁網址帶 mcustomize=news_view.jsp，列表頁沒有。
      return new Response(url.includes('news_view.jsp') ? viewFixture : fixture, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })
    }) as never
  })

  it('seed 有寫出 bodySelector（不是忘了設）', () => {
    expect(fscSeedConfig().bodySelector).toBeTypeOf('string')
  })

  it('對真實文章頁抽出正文，且不含頁首選單與頁尾', async () => {
    const entries = await fetchHtmlSelector(fscSeedConfig())
    const body = await entries[0]?.fetchBody?.()
    expect(body).toContain('保險資金')
    expect(body).toContain('聯絡電話')
    // 這兩個字串在整頁裡有、在正文容器裡沒有——它們是這條斷言的鑑別力來源。
    expect(body).not.toContain('網站導覽')
    expect(body).not.toContain('隱私權')
  })

  // 釘的不是解析器，是 fixture 本身的鑑別力：若整頁與正文容器抽出來的東西一樣，
  // 上面那條就算全綠也證明不了 bodySelector 有在做事。
  it('整頁與正文容器抽出來的東西確實不同', async () => {
    const entries = await fetchHtmlSelector({ ...fscSeedConfig(), bodySelector: 'body' })
    const whole = await entries[0]?.fetchBody?.()
    expect(whole).toContain('網站導覽')
    expect((whole ?? '').length).toBeGreaterThan(2000)
  })
})
