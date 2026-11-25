import type { AddressInfo } from 'node:net'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { detectCharset, extractArticleText, SCRAPE_DISPATCHER, scrapeArticle } from './scraper.js'

describe('extractArticleText', () => {
  it('shouldReturnConcatenatedParagraphText', () => {
    const html = `<html><body><article><p>台積電本季財報優於市場預期。</p><p>半導體產業顯示復甦跡象、外資看好後市。</p></article></body></html>`
    expect(extractArticleText(html)).toBe('台積電本季財報優於市場預期。\n半導體產業顯示復甦跡象、外資看好後市。')
  })

  it('shouldStripScriptsAndStyles', () => {
    const html = `<html><body><script>x=1</script><style>a{}</style><article><p>新聞的文字內容、長度足以超過三十字門檻、符合標準段落文字的要求。</p></article></body></html>`
    expect(extractArticleText(html)).toBe('新聞的文字內容、長度足以超過三十字門檻、符合標準段落文字的要求。')
  })

  it('shouldReturnNullWhenNoParagraphsFound', () => {
    expect(extractArticleText('<html><body></body></html>')).toBeNull()
  })

  it('shouldReturnNullWhenExtractedTooShort', () => {
    // 30 字以下視為解析失敗、fallback RSS excerpt
    expect(extractArticleText('<html><body><p>短</p></body></html>')).toBeNull()
  })

  it('shouldNotDuplicateParagraphsInNestedArticleBody', () => {
    // Real news site pattern: <body><article><p>...</p></article></body>
    // Test that a single <p> inside article isn't counted twice by grouped selector
    const html = `<html><body><article><p>台積電本季財報優於市場預期、半導體產業展現明顯的復甦跡象與動能。</p></article></body></html>`
    expect(extractArticleText(html)).toBe('台積電本季財報優於市場預期、半導體產業展現明顯的復甦跡象與動能。')
  })
})

// **呼叫失敗**與**呼叫成功但沒有內容**
// 在型別上必須分得開。改之前兩者共用同一個 `null`——非 2xx、timeout、DNS 失敗、
// 解析例外、以及「正文太短」這個完全合法的情境，五種狀況回同一個值，呼叫端連
// 「剛剛打過一次網路」都不知道。
// MoneyDJ 這類 Big5 站，Content-Type 常常不帶 charset（實測 curl -sI
// https://www.moneydj.com/ 回 `content-type: text/html`，完全沒有 charset= 片段），
// 而 undici 的 res.text() 一律當 UTF-8 解碼、解出來是 U+FFFD 加錯字。順序必須是
// 「header 有 charset 就聽 header」優先——因為同網域下 kmdj/news/newsviewer.aspx
// 那個路徑的 Content-Type **有** `charset=utf-8`、meta 卻沒寫，兩個真實頁面剛好互補
// 驗證了「不能只認其中一種訊號」。
describe('detectCharset', () => {
  const enc = (s: string): Uint8Array => new TextEncoder().encode(s)

  it('content-Type 帶 charset → 直接用，不管 meta 寫什麼（header 優先於 meta）', () => {
    const bytes = enc('<html><head><meta charset="utf-8"></head></html>')
    expect(detectCharset('text/html; charset=Big5', bytes)).toBe('big5')
  })

  it('content-Type 沒 charset → sniff <meta charset="X">', () => {
    const bytes = enc('<html><head><meta charset="Big5"></head></html>')
    expect(detectCharset('text/html', bytes)).toBe('big5')
  })

  it('content-Type 沒 charset → sniff <meta http-equiv="Content-Type" content="...;charset=X">', () => {
    const bytes = enc('<html><head><meta http-equiv="Content-Type" content="text/html; charset=Big5"></head></html>')
    expect(detectCharset(null, bytes)).toBe('big5')
  })

  it('header 與 meta 都沒有 charset → 回 utf-8', () => {
    const bytes = enc('<html><head><title>no charset anywhere</title></head></html>')
    expect(detectCharset('text/html', bytes)).toBe('utf-8')
  })

  it('content-Type 是 null 且沒有 meta → 回 utf-8', () => {
    expect(detectCharset(null, enc('<html></html>'))).toBe('utf-8')
  })

  it('big5 fixture：header 無 charset、meta 寫 big5（曾經觸發過 mojibake 的形狀）', () => {
    const bytes = readFileSync(new URL('./__fixtures__/big5-meta-no-header-charset.html', import.meta.url))
    expect(detectCharset('text/html', new Uint8Array(bytes))).toBe('big5')
  })
})

describe('scrapeArticle 的失敗/空結果契約', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function stubFetch(impl: (url: string, init?: { signal?: AbortSignal }) => Promise<Response> | never): void {
    vi.stubGlobal('fetch', vi.fn(impl))
  }

  // 改成 arrayBuffer 之後，假 Response 不能再只給 text()——scrapeArticle 讀的是
  // bytes 再自己解碼。預設沒有 content-type（null），purely-ASCII/中文的 goodHtml 在
  // 沒有 charset 訊號時 detectCharset 會落回 utf-8，跟原本 res.text() 的行為一致，
  // 既有測試不必逐條改斷言。
  function htmlResponse(html: string, status = 200, contentType: string | null = null): Response {
    const bytes = new TextEncoder().encode(html)
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (name: string) => name.toLowerCase() === 'content-type' ? contentType : null },
      arrayBuffer: async () => bytes.buffer,
    } as unknown as Response
  }

  const goodHtml = '<html><body><article><p>台積電本季財報優於市場預期、半導體產業展現明顯的復甦跡象與成長動能。</p></article></body></html>'

  it('抓到正文 → ok 且帶 text', async () => {
    stubFetch(async () => htmlResponse(goodHtml))
    const r = await scrapeArticle('https://news.example/a')
    expect(r.ok).toBe(true)
    expect(r.ok && r.text).toContain('台積電')
  })

  // hk.finance.yahoo.com 的標頭超過 undici 預設 16 KB 上限、整次 fetch 直接
  // Headers Overflow Error。這條斷的是接線層——拿掉 dispatcher 這條就會紅，
  // 但它證明不了 64 KB 真的擋得住超量標頭（那要靠下面「端到端實跑」章節的真實
  // HTTP 呼叫）。
  it('每次呼叫都帶上加大標頭上限的 dispatcher', async () => {
    const fetchSpy = vi.fn(async (_url: string, _init?: unknown) => htmlResponse(goodHtml))
    vi.stubGlobal('fetch', fetchSpy)
    await scrapeArticle('https://news.example/dispatcher-check')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const init = fetchSpy.mock.calls[0]?.[1] as { dispatcher?: unknown } | undefined
    expect(init?.dispatcher).toBe(SCRAPE_DISPATCHER)
  })

  // 真的以 Big5 編碼落地的 bytes（不是手寫的 UTF-8 字串假裝 Big5）餵進完整的
  // scrapeArticle 解碼路徑。用 extract: html => html 直接拿回解碼後的原始 HTML，
  // 而不是靠 extractArticleText 挑段落——這份樣本沒有夠長的 <p> 內文，挑段落會回
  // null、驗不到解碼本體對不對。
  it('big5 fixture（header 無 charset、meta 寫 big5）解碼出正確中文、不含 U+FFFD', async () => {
    const bytes = readFileSync(new URL('./__fixtures__/big5-meta-no-header-charset.html', import.meta.url))
    stubFetch(async () => ({
      ok: true,
      status: 200,
      headers: { get: (name: string) => name.toLowerCase() === 'content-type' ? 'text/html' : null },
      arrayBuffer: async () => new Uint8Array(bytes).buffer,
    } as unknown as Response))
    const r = await scrapeArticle('https://news.example/big5-home', { extract: html => html })
    expect(r.ok).toBe(true)
    expect(r.ok && r.text).not.toContain('�')
    expect(r.ok && r.text).toContain('合成樣本理財網')
  })

  // 未知 charset label 讓 `new TextDecoder(label)` 丟 RangeError；那是解碼問題，
  // 不是網路問題，必須接住並退回 utf-8——不能讓它穿出去被外層 catch 誤標成
  // network_error（那會讓下一個人往「連線失敗」的方向查，查不到任何東西）。
  it('未知的 charset label 退回 utf-8、不會被誤標成 network_error', async () => {
    stubFetch(async () => htmlResponse(goodHtml, 200, 'text/html; charset=not-a-real-charset-zzz'))
    const r = await scrapeArticle('https://news.example/badcharset')
    expect(r.ok).toBe(true)
    expect(r.ok && r.text).toContain('台積電')
  })

  it('呼叫成功但抽不出正文 → 仍是 ok、text 為 null（合法空結果）', async () => {
    stubFetch(async () => htmlResponse('<html><body><p>短</p></body></html>'))
    const r = await scrapeArticle('https://news.example/b')
    expect(r.ok).toBe(true)
    expect(r.ok && r.text).toBeNull()
  })

  it('非 2xx → ok:false + http_error，且帶得出狀態碼', async () => {
    stubFetch(async () => htmlResponse('', 403))
    const r = await scrapeArticle('https://news.example/c')
    expect(r.ok).toBe(false)
    expect(!r.ok && r.reason).toBe('http_error')
    expect(!r.ok && r.detail).toContain('403')
  })

  it('逾時 → ok:false + timeout', async () => {
    // 誠實的模擬：要等我們自己那顆計時器 abort 了才丟 AbortError。
    // 直接同步丟一個 AbortError 是**別人**丟的，那條走 network_error（見下）。
    stubFetch(async (_url, init) => await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        const err = new Error('The operation was aborted')
        err.name = 'AbortError'
        reject(err)
      })
    }))
    const r = await scrapeArticle('https://news.example/d', { timeoutMs: 5 })
    expect(r.ok).toBe(false)
    expect(!r.ok && r.reason).toBe('timeout')
    expect(!r.ok && r.detail).toBe('timeout after 5ms')
  })

  it('dNS/連線失敗 → ok:false + network_error，不被誤標成 timeout', async () => {
    // 判準同 market-data/fetch-source.ts：把連不上標成逾時，會讓下一個人往
    // 「對方太慢」的方向查，而真因是連都沒連上。
    stubFetch(async () => {
      throw new TypeError('fetch failed')
    })
    const r = await scrapeArticle('https://news.example/e')
    expect(r.ok).toBe(false)
    expect(!r.ok && r.reason).toBe('network_error')
    expect(!r.ok && r.detail).toContain('fetch failed')
  })

  it('body 讀到一半斷掉 → ok:false + network_error，不是靜默的空結果', async () => {
    // 「回應拿不完整」與「回應拿到了但是空的」是兩件事。firecrawl 那次就是把前者
    // 當成後者：它有回東西，只是那些東西沒有內容。
    stubFetch(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => {
        throw new Error('body stream failed midway')
      },
    } as unknown as Response))
    const r = await scrapeArticle('https://news.example/f')
    expect(r.ok).toBe(false)
    expect(!r.ok && r.reason).toBe('network_error')
  })

  it('解析拋例外 → ok:false + parse_error，不會穿出去害呼叫端把整個來源標成失敗', async () => {
    // 2026-08-22 驗收抓到的行為倒退：把 extract 移出 try 之後，解析一拋就穿出
    // scrapeArticle → pMap 的 Promise.all reject → 撞來源層 catch → 整個來源 failed。
    // 而來源的 RSS 是好的，那是 SLO 假告警。呼叫端那條測試在 refresh.test.ts。
    stubFetch(async () => htmlResponse(goodHtml))
    const r = await scrapeArticle('https://news.example/i', {
      extract: () => {
        throw new RangeError('Maximum call stack size exceeded')
      },
    })
    expect(r.ok).toBe(false)
    expect(!r.ok && r.reason).toBe('parse_error')
    expect(!r.ok && r.detail).toContain('Maximum call stack')
  })

  it('別人丟的 AbortError 不算逾時（不能憑空編一個 timeout after N ms）', async () => {
    // 只比對 err.name 的話，任何外部 abort 都會被標成「timeout after <我們的
    // timeoutMs>ms」——那個數字是編的。這裡的 AbortError 不是我們的計時器丟的。
    stubFetch(async () => {
      const err = new Error('aborted by someone else')
      err.name = 'AbortError'
      throw err
    })
    const r = await scrapeArticle('https://news.example/j', { timeoutMs: 10_000 })
    expect(r.ok).toBe(false)
    expect(!r.ok && r.reason).toBe('network_error')
  })

  it('body 讀取在逾時窗內：headers 回來了、body 永遠不結束，仍然逾時', async () => {
    // 這條**必須用真的 HTTP server**：假 Response 的 text() 不理會 AbortSignal，
    // 拿它來驗只是在驗自己的假物件。真實性質同時依賴兩件事——clearTimeout 留在
    // finally（不是提前到 res.text() 之前），以及 undici 會把 signal 接到 body
    // stream 上。原本沒有任何測試釘住它：把 clearTimeout 提前，12 條照樣全綠。
    vi.unstubAllGlobals()
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html', 'transfer-encoding': 'chunked' })
      res.write('<html><body><p>開頭</p>')
      // 故意不 end()
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    try {
      const r = await scrapeArticle(`http://127.0.0.1:${port}/`, { timeoutMs: 80 })
      expect(r.ok).toBe(false)
      expect(!r.ok && r.reason).toBe('timeout')
    }
    finally {
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  })

  it('★ 反向對照：「403」與「成功但沒正文」不再是同一個值', async () => {
    // 這條是這次改動的重點。改之前兩者都是 null、任何斷言都分不出來。
    stubFetch(async () => htmlResponse('', 403))
    const failed = await scrapeArticle('https://news.example/g')
    stubFetch(async () => htmlResponse('<html><body></body></html>'))
    const empty = await scrapeArticle('https://news.example/h')
    expect(failed).not.toEqual(empty)
    expect(failed.ok).toBe(false)
    expect(empty.ok).toBe(true)
  })
})
