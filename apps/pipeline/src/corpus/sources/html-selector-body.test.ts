import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchHtmlSelector } from './html-selector.js'

// 一則的列表；文章頁網址是 /a1。
const LISTING = '<ul class="list"><li><a href="/a1">標題一</a><span class="date">2026-08-20</span></li></ul>'

function listingOf(n: number): string {
  const items = Array.from({ length: n }, (_, i) => `<li><a href="/a${i}">標題${i}</a><span class="date">2026-08-20</span></li>`)
  return `<ul class="list">${items.join('')}</ul>`
}

const BASE = {
  listingUrl: 'https://x.com/list',
  itemSelector: 'ul.list > li',
  titleSelector: 'a',
  linkSelector: 'a',
  dateSelector: '.date',
}

function html(body: string): Response {
  return new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })
}

function routeFetch(routes: Array<[string, () => Response]>): void {
  globalThis.fetch = vi.fn(async (input: unknown) => {
    const url = String(input)
    const hit = routes.find(([frag]) => url.includes(frag))
    return hit ? hit[1]() : new Response('', { status: 404 })
  }) as never
}

function calls(): string[] {
  return (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.map(c => String(c[0]))
}

describe('html-selector 的 fetchBody', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('設了 bodySelector 就抓文章頁、抽出正文', async () => {
    routeFetch([
      ['/list', () => html(LISTING)],
      ['/a1', () => html('<div class="nav">選單</div><div class="body"><p>央行今日宣布維持政策利率不變。</p></div>')],
    ])
    const entries = await fetchHtmlSelector({ ...BASE, bodySelector: 'div.body' })
    expect(entries[0]?.fetchBody, '設了 bodySelector 的 entry 應該帶 fetchBody').toBeTypeOf('function')
    expect(await entries[0]?.fetchBody?.()).toContain('維持政策利率不變')
  })

  // 正文抽取要排掉頁首/選單這類共通版面，否則每篇文章的 body 都會被同一段 chrome 稀釋。
  it('正文只取 bodySelector 命中的容器，不含頁面其他區塊', async () => {
    routeFetch([
      ['/list', () => html(LISTING)],
      ['/a1', () => html('<div class="nav">全站選單文字</div><div class="body">正文內容</div><div class="foot">頁尾版權</div>')],
    ])
    const entries = await fetchHtmlSelector({ ...BASE, bodySelector: 'div.body' })
    const body = await entries[0]?.fetchBody?.()
    expect(body).toContain('正文內容')
    expect(body).not.toContain('全站選單文字')
    expect(body).not.toContain('頁尾版權')
  })

  it('script 與 style 的內容不算正文', async () => {
    routeFetch([
      ['/list', () => html(LISTING)],
      ['/a1', () => html('<div class="body"><script>var a=1</script><style>.x{color:red}</style>真正的內容</div>')],
    ])
    const entries = await fetchHtmlSelector({ ...BASE, bodySelector: 'div.body' })
    const body = await entries[0]?.fetchBody?.()
    expect(body).toBe('真正的內容')
  })

  // ★ 沒設 bodySelector 的來源維持原本行為（excerpt=null、不 enrich）。這條同時釘住
  //   「不該去打文章頁」——只斷言 fetchBody 是 undefined 的話，把它改成一個永遠回 null
  //   的函式仍會過，而那個版本每篇文章都會多打一次外部請求。
  it('沒設 bodySelector 時不帶 fetchBody、也不打文章頁', async () => {
    routeFetch([['/list', () => html(LISTING)]])
    const entries = await fetchHtmlSelector({ ...BASE })
    expect(entries[0]?.fetchBody).toBeUndefined()
    expect(calls().some(u => u.includes('/a1'))).toBe(false)
  })

  it('bodySelector 明寫 null（此來源刻意不抓正文）時不帶 fetchBody', async () => {
    routeFetch([['/list', () => html(LISTING)]])
    const entries = await fetchHtmlSelector({ ...BASE, bodySelector: null })
    expect(entries[0]?.fetchBody).toBeUndefined()
  })

  // 下面幾條的共同點：拿不到正文一律回 null 走「沒有 body 就不 enrich」那條路，
  // 不能往上拋——一篇文章的內文頁掛掉不該讓整輪 corpus refresh 失敗。
  it('文章頁 500 時回 null，不拋', async () => {
    routeFetch([
      ['/list', () => html(LISTING)],
      ['/a1', () => new Response('', { status: 500 })],
    ])
    const entries = await fetchHtmlSelector({ ...BASE, bodySelector: 'div.body' })
    expect(await entries[0]?.fetchBody?.()).toBeNull()
  })

  it('文章頁上 bodySelector 命中 0 個元素時回 null', async () => {
    routeFetch([
      ['/list', () => html(LISTING)],
      ['/a1', () => html('<div class="other">改版了</div>')],
    ])
    const entries = await fetchHtmlSelector({ ...BASE, bodySelector: 'div.body' })
    expect(await entries[0]?.fetchBody?.()).toBeNull()
  })

  // 命中了但裡面只有空白＝版面還在、內容搬走了。回空字串會讓一篇沒有內容的文章
  // 看起來有 body，接著被送去 enrich。
  it('正文容器只有空白時回 null，不是空字串', async () => {
    routeFetch([
      ['/list', () => html(LISTING)],
      ['/a1', () => html('<div class="body">   \n  </div>')],
    ])
    const entries = await fetchHtmlSelector({ ...BASE, bodySelector: 'div.body' })
    expect(await entries[0]?.fetchBody?.()).toBeNull()
  })

  // 錯誤頁常常是 HTTP 200 的 HTML，但把非 HTML（PDF、大型二進位）整包吞進 cheerio
  // 一樣是白花記憶體。content-type 是最便宜的第一道。
  //
  // ★ 回應內容刻意做成「拿掉守衛就抽得出正文」的樣子。第一版這裡放的是 '%PDF-1.5'，
  //   裡面沒有 div.body，於是 extractBody 兩條路徑都回 null——守衛有效與守衛不存在
  //   給出同一個答案，把 requireHtml 改成 false 的突變可以全綠存活。
  it('文章頁回的不是 HTML 時回 null', async () => {
    routeFetch([
      ['/list', () => html(LISTING)],
      ['/a1', () => new Response('<div class="body">這段不該被當成正文</div>', {
        status: 200,
        headers: { 'content-type': 'application/pdf' },
      })],
    ])
    const entries = await fetchHtmlSelector({ ...BASE, bodySelector: 'div.body' })
    expect(await entries[0]?.fetchBody?.()).toBeNull()
  })

  // 沒有上限的 res.text() 會讓整個 server 行程被 V8 的 heap limit 殺掉（exit 134、
  // catch 不到），而 corpus handler 與其他七個 kind、以及 HTTP server 全跑在同一個行程裡。
  it('文章頁超過大小上限時中斷、回 null', async () => {
    const huge = `<div class="body">${'x'.repeat(6 * 1024 * 1024)}</div>`
    routeFetch([
      ['/list', () => html(LISTING)],
      ['/a1', () => html(huge)],
    ])
    const entries = await fetchHtmlSelector({ ...BASE, bodySelector: 'div.body' })
    expect(await entries[0]?.fetchBody?.()).toBeNull()
  })

  it('列表頁超過大小上限時拋錯，不整包吞進記憶體', async () => {
    routeFetch([['/list', () => html('y'.repeat(6 * 1024 * 1024))]])
    await expect(fetchHtmlSelector({ ...BASE })).rejects.toThrow(/too large|上限/i)
  })

  // 整批失敗（對方節流、站台改版）時要短路，否則 N 篇 × timeout 會把
  // corpus-refresh 推出 90 分鐘的 staleness 窗、被當成孤兒 job。
  it('正文連續失敗達門檻後短路，不再打文章頁', async () => {
    routeFetch([
      ['/list', () => html(listingOf(8))],
      ['/a', () => new Response('', { status: 500 })],
    ])
    const entries = await fetchHtmlSelector({ ...BASE, bodySelector: 'div.body' })
    for (const e of entries)
      expect(await e.fetchBody?.()).toBeNull()
    const articleCalls = calls().filter(u => /\/a\d/.test(u))
    expect(articleCalls.length).toBe(5)
  })

  // 短路是「連續」失敗、不是「累計」失敗：中間成功一次就該歸零，否則一個偶爾漏抓的
  // 來源跑到後面會整批只剩標題。
  it('中間成功一次會把連續失敗計數歸零', async () => {
    let n = 0
    routeFetch([
      ['/list', () => html(listingOf(12))],
      ['/a', () => {
        n++
        // 前 4 次失敗、第 5 次成功、之後全失敗：若計數不歸零，第 5 次之後只會再打 1 次。
        return n === 5 ? html('<div class="body">有內容</div>') : new Response('', { status: 500 })
      }],
    ])
    const entries = await fetchHtmlSelector({ ...BASE, bodySelector: 'div.body' })
    for (const e of entries)
      await e.fetchBody?.()
    expect(calls().filter(u => /\/a\d/.test(u)).length).toBe(10)
  })

  it('文章頁的請求帶上 config.headers', async () => {
    routeFetch([
      ['/list', () => html(LISTING)],
      ['/a1', () => html('<div class="body">內容</div>')],
    ])
    const entries = await fetchHtmlSelector({ ...BASE, bodySelector: 'div.body', headers: { 'X-Test': 'yes' } })
    await entries[0]?.fetchBody?.()
    const init = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.find(c => String(c[0]).includes('/a1'))?.[1] as { headers?: Record<string, string> } | undefined
    expect(init?.headers?.['X-Test']).toBe('yes')
  })
})
