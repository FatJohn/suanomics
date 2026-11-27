import type { SeriesSpec } from './series-config.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import tpexIndex from './__fixtures__/tpex-index.json' with { type: 'json' }
import { SERIES_SPECS } from './series-config.js'
import { fetchTpexSeries, parseTpexIndex } from './tpex-client.js'

afterEach(() => vi.unstubAllGlobals())

describe('parseTpexIndex', () => {
  it('取 Date（西元 yyyymmdd）與 Close', () => {
    const pts = parseTpexIndex(tpexIndex)
    expect(pts).toHaveLength(4)
    // 2026-11-25 櫃買跌 5.89%：收 275.97
    expect(pts.find(p => p.date === '2026-11-25')).toEqual({ date: '2026-11-25', value: 275.97 })
  })

  it('跳過收盤不是數字的列', () => {
    expect(parseTpexIndex([
      { Date: '20261127', Close: '285.77' },
      { Date: '20261126', Close: '--' },
      { Date: '', Close: '1' },
    ])).toEqual([{ date: '2026-11-27', value: 285.77 }])
  })

  it('body 不是陣列時回空並 warn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(parseTpexIndex({ message: 'error' })).toEqual([])
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('fetchTpexSeries', () => {
  it('打 TPEx OpenAPI 的 sourceCode 路徑', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(tpexIndex), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const spec = SERIES_SPECS.find(s => s.seriesId === 'tpex-close') as SeriesSpec
    const pts = await fetchTpexSeries(spec)
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe('https://www.tpex.org.tw/openapi/v1/tpex_index')
    expect(pts.at(-1)).toEqual({ date: '2026-11-27', value: 285.77 })
  })
})
