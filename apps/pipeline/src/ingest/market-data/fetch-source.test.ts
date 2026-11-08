import { Buffer } from 'node:buffer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchSource } from './fetch-source.js'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function ok(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body, arrayBuffer: async () => new ArrayBuffer(0) } as unknown as Response
}

describe('fetchSource', () => {
  it('200 時回傳 decode 的結果', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok({ hello: 'world' })))
    await expect(fetchSource('https://x.test/a', { label: 'twse-client: FMTQIK' })).resolves.toEqual({ hello: 'world' })
  })

  it('預設 decode 是 res.json()，可用 decode 換成別的解碼', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode('abc').buffer } as unknown as Response)))
    const out = await fetchSource('https://x.test/a', {
      label: 'taifex-client: TXF',
      decode: async res => new TextDecoder('utf-8').decode(Buffer.from(await res.arrayBuffer())),
    })
    expect(out).toBe('abc')
  })

  // 錯誤訊息一律帶 label：四個 client 的失敗在同一份 refresh 報告裡混排，
  // 少了 label 就分不出是哪個資料源倒了。
  it('非 200 時拋出帶 label 與 status 的錯誤', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503 } as unknown as Response)))
    await expect(fetchSource('https://x.test/a', { label: 'fred-client: DFII10' }))
      .rejects
      .toThrow('fred-client: DFII10 HTTP 503')
  })

  // 曾經修過的那個洞：少了這段轉譯，逾時會以裸 AbortError 冒出來，
  // 讀 refresh 報告的人看到的是「something aborted」而不是「哪個源逾時了」。
  it('abortError 轉成具名 timeout 錯誤', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' })
    vi.stubGlobal('fetch', vi.fn(async (): Promise<Response> => {
      throw abort
    }))
    await expect(fetchSource('https://x.test/a', { label: 'nasdaq-client: SOX', timeoutMs: 1234 }))
      .rejects
      .toThrow('nasdaq-client: SOX timeout after 1234ms')
  })

  // 反向守衛：不是每個錯誤都是逾時。把 DNS 失敗標成 timeout 會讓人去查錯方向。
  it('非 AbortError 原樣往外拋、不冒充成 timeout', async () => {
    vi.stubGlobal('fetch', vi.fn(async (): Promise<Response> => {
      throw new Error('getaddrinfo ENOTFOUND')
    }))
    await expect(fetchSource('https://x.test/a', { label: 'fred-client: DFII10' }))
      .rejects
      .toThrow('getaddrinfo ENOTFOUND')
  })

  it('decode 自己拋的錯不會被誤判成 timeout', async () => {
    const json = async (): Promise<unknown> => {
      throw new Error('Unexpected token <')
    }
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json } as unknown as Response)))
    await expect(fetchSource('https://x.test/a', { label: 'twse-client: BFI82U' }))
      .rejects
      .toThrow('Unexpected token <')
  })

  it('init 原樣傳給 fetch、並補上 abort signal', async () => {
    const spy = vi.fn(async () => ok({}))
    vi.stubGlobal('fetch', spy)
    await fetchSource('https://x.test/a', {
      label: 'taifex-client: TXF',
      init: { method: 'POST', headers: { 'User-Agent': 'Mozilla/5.0' }, body: 'a=1' },
    })
    const init = spy.mock.calls[0]?.[1] as RequestInit
    expect(init.method).toBe('POST')
    expect(init.body).toBe('a=1')
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  // 成功後計時器沒清掉的話，process 會被吊著到 timeout 為止——
  // refresh 腳本跑完不退出就是這麼來的。
  it('成功時清掉計時器', async () => {
    const clear = vi.spyOn(globalThis, 'clearTimeout')
    vi.stubGlobal('fetch', vi.fn(async () => ok({})))
    await fetchSource('https://x.test/a', { label: 'twse-client: FMTQIK' })
    expect(clear).toHaveBeenCalled()
  })

  it('失敗時也清掉計時器', async () => {
    const clear = vi.spyOn(globalThis, 'clearTimeout')
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 } as unknown as Response)))
    await expect(fetchSource('https://x.test/a', { label: 'twse-client: FMTQIK' })).rejects.toThrow()
    expect(clear).toHaveBeenCalled()
  })
})
