import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMarketStore } from './market.js'

describe('useMarketStore', () => {
  beforeEach(() => setActivePinia(createPinia()))
  afterEach(() => vi.unstubAllGlobals())

  it('shouldStartIdleWithEmptyKeyNumbers', () => {
    const s = useMarketStore()
    expect(s.status).toBe('idle')
    expect(s.keyNumbers).toEqual([])
  })

  it('shouldPopulateKeyNumbersOnSuccess', async () => {
    const series = [{
      seriesId: 'taiex-close',
      label: '加權指數',
      unit: '點',
      section: 'taiwan',
      kind: 'level',
      direction: 'up',
      latest: { date: '2026-06-13', value: 23150 },
      previous: { date: '2026-06-12', value: 23000 },
    }]
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ series }) })))
    const s = useMarketStore()
    const p = s.fetchKeyNumbers()
    expect(s.status).toBe('loading')
    await p
    expect(s.status).toBe('success')
    expect(s.keyNumbers).toHaveLength(1)
    expect(s.keyNumbers[0]?.latest.value).toBe(23150)
  })

  it('shouldSetErrorAndClearOnFailure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })))
    const s = useMarketStore()
    await s.fetchKeyNumbers()
    expect(s.status).toBe('error')
    expect(s.keyNumbers).toEqual([])
  })

  // 無日期一律打不帶 query 的網址——`/` 首頁的即時卡片不能被歷史頁的改動牽動。
  it('shouldFetchWithoutQueryWhenNoDateGiven', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ series: [] }) }))
    vi.stubGlobal('fetch', fetchMock)
    const s = useMarketStore()
    await s.fetchKeyNumbers()
    expect(fetchMock).toHaveBeenCalledWith(expect.not.stringContaining('?date='))
  })

  // 主線：帶日期要打帶 `?date=` 的網址，這是 `/d/:date` 歷史頁拿到那天收盤的唯一入口。
  it('shouldFetchWithDateQueryWhenDateGiven', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ series: [] }) }))
    vi.stubGlobal('fetch', fetchMock)
    const s = useMarketStore()
    await s.fetchKeyNumbers('2026-08-15')
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('?date=2026-08-15'))
  })
})
