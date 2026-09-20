import { afterEach, describe, expect, it, vi } from 'vitest'
import bfi82u from './__fixtures__/twse-bfi82u-legacy.json'
import fmtqik from './__fixtures__/twse-fmtqik.json'
import miMargn from './__fixtures__/twse-mi-margn-legacy.json'
import twt93u from './__fixtures__/twse-twt93u-legacy.json'
import {
  fetchTwseDataset,
  parseInstitutionalNet,
  parseMarginBalance,
  parseMarginShortBalance,
  parseRocDate,
  parseSblBalance,
  parseTaiexClose,
} from './twse-client.js'

function okJson(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 })
}

afterEach(() => vi.unstubAllGlobals())

describe('parseRocDate', () => {
  it('converts ROC slash date to ISO', () => {
    expect(parseRocDate('115/06/11')).toBe('2026-06-11')
  })
  it('converts ROC yyyymmdd (7 digit) to ISO — FMTQIK 的 Date 欄', () => {
    expect(parseRocDate('1150611')).toBe('2026-06-11')
  })
  it('passes through ISO yyyymmdd (8 digit)', () => {
    expect(parseRocDate('20260611')).toBe('2026-06-11')
  })
})

describe('parseTaiexClose', () => {
  it('extracts date + TAIEX close from FMTQIK rows', () => {
    const pts = parseTaiexClose(fmtqik as unknown[])
    expect(pts.length).toBeGreaterThan(0)
    expect(pts[0]?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    // 加權指數量級（fixture 真值落在四萬多點）
    expect(pts[0]?.value).toBeGreaterThan(1000)
  })

  it('matches the first fixture row exactly', () => {
    const pts = parseTaiexClose(fmtqik as unknown[])
    // fixture row 0：Date 1150601 / TAIEX 45337.91
    expect(pts.find(p => p.date === '2026-06-01')?.value).toBeCloseTo(45337.91)
  })

  it('skips non-finite TAIEX values', () => {
    const out = parseTaiexClose([
      { Date: '1150611', TAIEX: '43149.46' },
      { Date: '1150610', TAIEX: '--' },
    ])
    expect(out).toEqual([{ date: '2026-06-11', value: 43149.46 }])
  })
})

describe('parseMarginBalance', () => {
  it('extracts 融資金額(仟元) 今日餘額 from legacy table, converts 仟元 → 億元', () => {
    const pts = parseMarginBalance(miMargn)
    expect(pts).toHaveLength(1)
    // fixture 今日餘額 549,176,982 仟元 ×1000÷1e8 = 5491.76982 億元
    expect(pts[0]?.value).toBeCloseTo(5491.76982, 4)
    // 頂層 date 20260611 → ISO
    expect(pts[0]?.date).toBe('2026-06-11')
  })

  it('returns empty array + warns when stat is not OK', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(parseMarginBalance({ stat: 'no data', tables: [] })).toEqual([])
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('parseMarginShortBalance', () => {
  it('extracts 融券(交易單位) 今日餘額 from MI_MARGN legacy table (張, 無換算)', () => {
    const pts = parseMarginShortBalance(miMargn)
    expect(pts).toHaveLength(1)
    // fixture 融券(交易單位) 今日餘額 224,344 張（張直接用、無換算）
    expect(pts[0]?.value).toBe(224344)
    // 頂層 date 20260611 → ISO
    expect(pts[0]?.date).toBe('2026-06-11')
  })

  it('returns empty array + warns when stat is not OK', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(parseMarginShortBalance({ stat: '很抱歉，沒有符合條件的資料' })).toEqual([])
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('parseInstitutionalNet', () => {
  it('extracts 合計 row 買賣差額 from legacy data, converts 元 → 億元', () => {
    const pts = parseInstitutionalNet(bfi82u)
    expect(pts).toHaveLength(1)
    // fixture 合計 買賣差額 50,569,809,639 元 ÷1e8 = 505.69809639 億元
    expect(pts[0]?.value).toBeCloseTo(505.69809639, 4)
    // 頂層 date 20260612 → ISO
    expect(pts[0]?.date).toBe('2026-06-12')
  })

  it('returns empty array + warns when stat is not OK', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(parseInstitutionalNet({ stat: 'no data', data: [] })).toEqual([])
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('parseSblBalance', () => {
  it('extracts 合計 row 借券賣出當日餘額 (index 12), converts 股 → 億股', () => {
    const pts = parseSblBalance(twt93u)
    expect(pts).toHaveLength(1)
    // fixture 合計 當日餘額 17,964,026,633 股 ÷1e8 = 179.64026633 億股（不受個股列干擾）
    expect(pts[0]?.value).toBeCloseTo(179.64026633, 4)
    // 頂層 date 20260709 → ISO
    expect(pts[0]?.date).toBe('2026-07-09')
  })

  it('returns empty array + warns when stat is not OK', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(parseSblBalance({ stat: '很抱歉，沒有符合條件的資料' })).toEqual([])
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('returns empty array on empty data (非交易日 stat OK 但 data:[])', () => {
    expect(parseSblBalance({ stat: 'OK', date: '20260710', data: [] })).toEqual([])
  })

  it('returns empty + warns when 當日餘額 column shifts (fields[12] 防呆)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const shifted = {
      stat: 'OK',
      date: '20260709',
      fields: ['代號', '名稱', 'x', 'x', 'x', 'x', 'x', 'x', 'x', 'x', 'x', 'x', '前日餘額', 'x', 'x'],
      data: [['', '合計', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '99', '0', ' ']],
    }
    expect(parseSblBalance(shifted)).toEqual([])
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('fetchTwseDataset', () => {
  it('returns parsed JSON array on 200', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okJson([{ a: 1 }])))
    const out = await fetchTwseDataset('/v1/exchangeReport/FMTQIK')
    expect(out).toEqual([{ a: 1 }])
  })

  it('throws including endpoint + status on non-200', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })))
    await expect(fetchTwseDataset('/v1/exchangeReport/FMTQIK')).rejects.toThrow(/FMTQIK.*500/)
  })

  it('wraps AbortError into a timeout message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      const e = new Error('aborted')
      e.name = 'AbortError'
      throw e
    }))
    await expect(fetchTwseDataset('/v1/exchangeReport/FMTQIK', 5)).rejects.toThrow(/timeout after 5ms/)
  })
})
