import type { FixtureManifest, FixtureProvenance } from './manifest.js'
import { describe, expect, it, vi } from 'vitest'
import { checkEntry, formatReport, hasFailure } from './check.js'

const manifest: FixtureManifest = { baseUrl: 'file:///x/manifest.ts', label: 'test', entries: [] }

function entry(over: Partial<FixtureProvenance> = {}): FixtureProvenance {
  return {
    file: 'sample.json',
    kind: 'json',
    origin: 'captured',
    url: 'https://example.invalid/api',
    transform: 'as-is',
    ...over,
  }
}

function deps(opts: { fixture?: string, live?: unknown, throws?: Error }) {
  return {
    readFixture: () => opts.fixture ?? '[{"a":"1"}]',
    fetchLive: async () => {
      if (opts.throws)
        throw opts.throws
      return opts.live
    },
  }
}

describe('checkEntry', () => {
  it('形狀相同回 match（反向對照：不得誤報）', async () => {
    const o = await checkEntry(manifest, entry(), deps({ live: [{ a: '2' }] }))
    expect(o.status).toBe('match')
    expect(o.drifts).toEqual([])
  })

  it('欄位消失回 drift 並列出是哪個欄位', async () => {
    const o = await checkEntry(manifest, entry(), deps({ fixture: '[{"a":"1","b":"2"}]', live: [{ a: '1' }] }))
    expect(o.status).toBe('drift')
    expect(o.drifts.map(d => d.path)).toContain('[].b')
  })

  it('多出新欄位只是 info，不算 drift', async () => {
    const o = await checkEntry(manifest, entry(), deps({ live: [{ a: '1', extra: 1 }] }))
    expect(o.status).toBe('match')
    expect(o.drifts.every(d => d.severity === 'info')).toBe(true)
  })

  // 這一格是這支工具最容易誤報、然後被整個無視的地方：非交易日 TWSE 回空陣列，
  // 樣本裡每個欄位都會被判成「現況沒有」。特判成 empty-live 而不是 drift。
  it('對方回空陣列是 empty-live，不是 drift', async () => {
    const o = await checkEntry(manifest, entry(), deps({ live: [] }))
    expect(o.status).toBe('empty-live')
    expect(o.drifts).toEqual([])
  })

  it('打不到對方是 unreachable，不算樣本過期', async () => {
    const o = await checkEntry(manifest, entry(), deps({ throws: new Error('ETIMEDOUT') }))
    expect(o.status).toBe('unreachable')
    expect(o.detail).toContain('ETIMEDOUT')
    expect(hasFailure([o])).toBe(false)
  })

  it('非 JSON 樣本標 skipped 而不是靜靜略過', async () => {
    const o = await checkEntry(manifest, entry({ kind: 'opaque' }), deps({ live: [{ a: '1' }] }))
    expect(o.status).toBe('skipped')
    expect(o.detail).toContain('人工')
  })

  it('沒有對應 URL 的通用範例也標 skipped', async () => {
    const o = await checkEntry(manifest, entry({ url: null }), deps({ live: [{ a: '1' }] }))
    expect(o.status).toBe('skipped')
  })

  // 這才是這支工具真正的用途：手寫樣本填了真實 URL 時，這一比就是在問
  // 「這個人推測出來的形狀，真實 API 到底回不回」——firecrawl 就是這樣漏掉的。
  it('手寫樣本照樣比對，形狀對不上就 drift', async () => {
    const o = await checkEntry(
      manifest,
      entry({ origin: 'synthetic' }),
      deps({ fixture: '[{"markdown":"x"}]', live: [{ description: 'x' }] }),
    )
    expect(o.status).toBe('drift')
    expect(o.drifts.find(d => d.path === '[].markdown')?.severity).toBe('breaking')
  })

  it('樣本本身不是合法 JSON 也要叫', async () => {
    const o = await checkEntry(manifest, entry(), deps({ fixture: '{oops', live: [{ a: '1' }] }))
    expect(o.status).toBe('drift')
    expect(o.detail).toContain('不是合法 JSON')
  })

  it('unreachable 時不去讀樣本檔（省一次無謂的 I/O，也讓失敗原因單一）', async () => {
    const readFixture = vi.fn(() => '[]')
    const fetchLive = async (): Promise<never> => {
      throw new Error('boom')
    }
    await checkEntry(manifest, entry(), { readFixture, fetchLive })
    expect(readFixture).not.toHaveBeenCalled()
  })
})

describe('formatReport', () => {
  it('手寫與出處未核實在每一行都標出來', async () => {
    const a = await checkEntry(manifest, entry({ origin: 'synthetic', file: 'hand.json' }), deps({ live: [{ a: '1' }] }))
    const b = await checkEntry(manifest, entry({ origin: 'unverified', file: 'old.json' }), deps({ live: [{ a: '1' }] }))
    const text = formatReport([a, b]).join('\n')
    expect(text).toContain('hand.json [手寫樣本')
    expect(text).toContain('old.json [出處未核實')
    expect(text).toContain('手寫 1')
    expect(text).toContain('未核實 1')
  })

  // origin 與「形狀對過沒有」是兩件獨立的事，報告要分開講：手寫但形狀對過的樣本
  // 比「像真的但沒人對過」的可信，把兩者混成一個標籤會讓讀的人做錯判斷。
  it('形狀對過與否獨立於 origin 標出來', async () => {
    const verified = await checkEntry(manifest, entry({ origin: 'synthetic', file: 'ok.json', shapeVerifiedAt: '2026-08-22' }), deps({ live: [{ a: '1' }] }))
    const never = await checkEntry(manifest, entry({ origin: 'unverified', file: 'never.json' }), deps({ live: [{ a: '1' }] }))
    const text = formatReport([verified, never]).join('\n')
    expect(text).toContain('ok.json [手寫樣本・形狀 2026-08-22 對過]')
    expect(text).toContain('never.json [出處未核實・形狀未對過]')
  })
})

describe('formatReport 的總結行', () => {
  // 2026-08-22 驗收指出的缺陷：全部打不到對方時，舊版最後一行是「drift 0」——
  // 一眼讀起來像全過，實際上什麼都沒驗到。
  it('全部打不到時要明說「沒有任何一份真的對到」', async () => {
    const o = await checkEntry(manifest, entry(), deps({ throws: new Error('ETIMEDOUT') }))
    const text = formatReport([o]).join('\n')
    expect(text).toContain('打不到 1')
    expect(text).toContain('沒有任何一份樣本真的跟現實對到')
  })

  it('有對到時不出現那句警告（反向對照）', async () => {
    const o = await checkEntry(manifest, entry(), deps({ live: [{ a: '1' }] }))
    const text = formatReport([o]).join('\n')
    expect(text).toContain('對到 1')
    expect(text).not.toContain('沒有任何一份樣本真的跟現實對到')
  })
})

describe('hasFailure', () => {
  it('只有 drift 算失敗，skipped / empty / unreachable 都不算', async () => {
    const skipped = await checkEntry(manifest, entry({ kind: 'opaque' }), deps({ live: [] }))
    const empty = await checkEntry(manifest, entry(), deps({ live: [] }))
    expect(hasFailure([skipped, empty])).toBe(false)
    const drift = await checkEntry(manifest, entry(), deps({ fixture: '[{"a":"1","b":"2"}]', live: [{ a: '1' }] }))
    expect(hasFailure([skipped, empty, drift])).toBe(true)
  })
})
