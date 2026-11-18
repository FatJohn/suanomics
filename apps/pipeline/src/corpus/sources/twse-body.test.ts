import { extractText } from 'unpdf'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchRssSource } from './rss.js'

// mock unpdf：這裡要驗的是「怎麼找到那份 PDF、拿不到時怎麼降級」，不是 pdf.js 的解析能力。
// 真實解析能力用一次性實測確認過（見 PR 描述），不放進單元測試——那需要一份 290KB 的
// PDF fixture，而它驗的是別人家的函式庫。
vi.mock('unpdf', () => ({
  getDocumentProxy: vi.fn(async () => ({ mocked: true })),
  extractText: vi.fn(async () => ({ text: '頁 1\n加權股價指數收盤為 45,224.29 點', totalPages: 1 })),
}))

const LIST = JSON.stringify([
  { Title: '本週發行量加權股價指數跌幅約為1.28%', Url: 'https://www.twse.com.tw/zh/about/news/news/content.html?ABC123', Date: '1150821' },
])
const DETAIL_WITH_PDF = JSON.stringify({
  stat: 'ok',
  tables: [{ title: 't', fields: ['text', 'html', 'pdf', 'lang'], data: ['', '', '/news/news/tsecnews/XYZ.pdf', 'zh-tw'] }],
})

// `%PDF-1.5` 的前八個 byte。實作會檢查 magic bytes——TWSE 的路徑組錯時回的是 HTTP 200
// 的 HTML 錯誤頁（soft-404），只靠 res.ok 擋不住，錯誤頁會被送進 unpdf 當 PDF 解。
const FAKE_PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x35])
function pdfResponse(body: Uint8Array = FAKE_PDF): Response {
  return new Response(body, { status: 200, headers: { 'content-type': 'application/pdf' } })
}

function routeFetch(routes: Array<[string, () => Response]>): void {
  globalThis.fetch = vi.fn(async (input: unknown) => {
    const url = String(input)
    const hit = routes.find(([frag]) => url.includes(frag))
    return hit ? hit[1]() : new Response('', { status: 404 })
  }) as never
}

async function firstBody(routes: Array<[string, () => Response]>): Promise<string | null> {
  routeFetch(routes)
  const entries = await fetchRssSource({ feedUrl: 'https://openapi.twse.com.tw/v1/news/newsList', format: 'twse-news-json' })
  expect(entries).toHaveLength(1)
  expect(entries[0]?.fetchBody, 'twse-news-json 的 entry 應該帶 fetchBody').toBeTypeOf('function')
  return (await entries[0]?.fetchBody?.()) ?? null
}

describe('twse-news-json 的 fetchBody', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('走 newsDetail 找到 pdf 路徑、抓回來抽出正文', async () => {
    const body = await firstBody([
      ['newsList', () => new Response(LIST, { status: 200 })],
      ['newsDetail', () => new Response(DETAIL_WITH_PDF, { status: 200 })],
      ['/staticFiles/news/news/tsecnews/XYZ.pdf', () => pdfResponse()],
    ])
    expect(body).toContain('45,224.29')
  })

  it('正文 PDF 的路徑要接在 /staticFiles 底下（前端 web-news.js 就是這樣組的）', async () => {
    await firstBody([
      ['newsList', () => new Response(LIST, { status: 200 })],
      ['newsDetail', () => new Response(DETAIL_WITH_PDF, { status: 200 })],
      ['/staticFiles/news/news/tsecnews/XYZ.pdf', () => pdfResponse()],
    ])
    const called = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.map(c => String(c[0]))
    expect(called.some(u => u.includes('/staticFiles/news/news/tsecnews/XYZ.pdf'))).toBe(true)
  })

  // 這則的 id 帶特殊字元。少了這條，拿掉 encodeURIComponent 的突變會存活。
  it('newsDetail 的 id 有做 URL 編碼', async () => {
    const weird = JSON.stringify([{ Title: 't', Url: 'https://www.twse.com.tw/x?a b&c=1', Date: '1150821' }])
    await firstBody([
      ['newsList', () => new Response(weird, { status: 200 })],
      ['newsDetail', () => new Response(DETAIL_WITH_PDF, { status: 200 })],
      ['/staticFiles/', () => pdfResponse()],
    ])
    const called = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.map(c => String(c[0]))
    const detailCall = called.find(u => u.includes('newsDetail')) ?? ''
    expect(detailCall).toContain('a%20b%26c%3D1')
  })

  // soft-404：TWSE 路徑組錯時回 HTTP 200 的 HTML 錯誤頁，res.ok 擋不住。
  it('回應不是 PDF（HTML 錯誤頁）時回 null，不送進解析器', async () => {
    const body = await firstBody([
      ['newsList', () => new Response(LIST, { status: 200 })],
      ['newsDetail', () => new Response(DETAIL_WITH_PDF, { status: 200 })],
      ['/staticFiles/', () => new Response('<html>404</html>', { status: 200, headers: { 'content-type': 'text/html' } })],
    ])
    expect(body).toBeNull()
  })

  it('content-type 說是 PDF 但內容不是（magic bytes 不符）時回 null', async () => {
    const body = await firstBody([
      ['newsList', () => new Response(LIST, { status: 200 })],
      ['newsDetail', () => new Response(DETAIL_WITH_PDF, { status: 200 })],
      ['/staticFiles/', () => pdfResponse(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))],
    ])
    expect(body).toBeNull()
  })

  // 沒有上限的 arrayBuffer() 會讓整個 server 行程被 V8 的 heap limit 殺掉（exit 134、
  // catch 不到）。這條釘住那道上限；20MB 的門檻寫在 rss.ts 的 MAX_PDF_BYTES。
  it('正文 PDF 超過大小上限時中斷、回 null', async () => {
    const huge = new Uint8Array(21 * 1024 * 1024)
    huge.set(FAKE_PDF, 0)
    const body = await firstBody([
      ['newsList', () => new Response(LIST, { status: 200 })],
      ['newsDetail', () => new Response(DETAIL_WITH_PDF, { status: 200 })],
      ['/staticFiles/', () => pdfResponse(huge)],
    ])
    expect(body).toBeNull()
  })

  // 抽不出字＝掃描影像型的 PDF。這是「TWSE 換了 PDF 產生器」的唯一訊號，不能讓空字串
  // 進 corpus 假裝有內容。少了這條，把 `merged === '' ? null : merged` 改成恆回 merged
  // 的突變會存活。
  it('正文 PDF 抽不出任何文字（掃描檔）時回 null，不是空字串', async () => {
    vi.mocked(extractText).mockResolvedValueOnce({ text: '   \n  ', totalPages: 1 } as never)
    const body = await firstBody([
      ['newsList', () => new Response(LIST, { status: 200 })],
      ['newsDetail', () => new Response(DETAIL_WITH_PDF, { status: 200 })],
      ['/staticFiles/', () => pdfResponse()],
    ])
    expect(body).toBeNull()
  })

  // ★ 這條釘的是「用 fields 對位」而不是「寫死 index」。少了它，把
  //   `fields.indexOf('pdf')` 改成寫死 `data[2]` 的突變會存活——因為上面兩條 fixture 的
  //   pdf 剛好就在第 2 格，而「沒有 pdf 欄位」那條的 data[2] 是 'zh-tw'，湊出來的路徑
  //   404 之後一樣回 null，測試分辨不出差別。
  it('pdf 欄位不在固定位置時也要找得到', async () => {
    const reordered = JSON.stringify({
      stat: 'ok',
      tables: [{ fields: ['pdf', 'text', 'html', 'lang'], data: ['/news/news/tsecnews/XYZ.pdf', '', '', 'zh-tw'] }],
    })
    const body = await firstBody([
      ['newsList', () => new Response(LIST, { status: 200 })],
      ['newsDetail', () => new Response(reordered, { status: 200 })],
      ['/staticFiles/news/news/tsecnews/XYZ.pdf', () => pdfResponse()],
    ])
    expect(body).toContain('45,224.29')
  })

  // 下面幾條的共同點：拿不到正文要回 null 走「沒有 body 就不 enrich」那條路，
  // 不能往上拋——一篇公告的 PDF 掛掉不該讓整輪 corpus refresh 失敗。
  it('newsDetail 沒有 pdf 欄位時回 null', async () => {
    const noPdf = JSON.stringify({ stat: 'ok', tables: [{ fields: ['text', 'html', 'lang'], data: ['', '', 'zh-tw'] }] })
    const body = await firstBody([
      ['newsList', () => new Response(LIST, { status: 200 })],
      ['newsDetail', () => new Response(noPdf, { status: 200 })],
    ])
    expect(body).toBeNull()
    // ★ 不只是回 null——根本不該去打 /staticFiles。少了這條斷言，拿掉 `if (!pdfPath)`
    //   的突變會存活：它會去打 `/staticFilesundefined`，soft-404 之後同樣回 null。
    const called = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.map(c => String(c[0]))
    expect(called.some(u => u.includes('/staticFiles'))).toBe(false)
  })

  it('正文 PDF 下載失敗時回 null，不拋', async () => {
    const body = await firstBody([
      ['newsList', () => new Response(LIST, { status: 200 })],
      ['newsDetail', () => new Response(DETAIL_WITH_PDF, { status: 200 })],
      ['/staticFiles/', () => new Response('', { status: 500 })],
    ])
    expect(body).toBeNull()
  })

  it('newsDetail 回非 JSON 時回 null，不拋', async () => {
    const body = await firstBody([
      ['newsList', () => new Response(LIST, { status: 200 })],
      ['newsDetail', () => new Response('<html>維護中</html>', { status: 200 })],
    ])
    expect(body).toBeNull()
  })

  it('網址沒有 query id 時回 null（拿不到 newsDetail 的 id）', async () => {
    const noId = JSON.stringify([{ Title: 't', Url: 'https://www.twse.com.tw/zh/about/news/news/content.html', Date: '1150821' }])
    const body = await firstBody([['newsList', () => new Response(noId, { status: 200 })]])
    expect(body).toBeNull()
  })
})
