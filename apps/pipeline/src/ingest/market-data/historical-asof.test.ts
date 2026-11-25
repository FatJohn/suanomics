import type { SeriesFreshness } from '@suanomics/shared'
import { describe, expect, it, vi } from 'vitest'
import { buildSeriesAsOf, formatAsOfNotice, loadHistoricalSeriesAsOf } from './historical-asof.js'
import { SERIES_SPECS } from './series-config.js'

function freshness(overrides: Partial<SeriesFreshness> & { seriesId: string }): SeriesFreshness {
  return {
    expectedAsOf: '2026-08-24',
    actualAsOf: '2026-08-24',
    lagCycles: 0,
    state: 'fresh',
    ...overrides,
  }
}

describe('buildSeriesAsOf', () => {
  it('逐筆取 seriesId → actualAsOf', () => {
    const result = buildSeriesAsOf([
      freshness({ seriesId: 'taiex-close', actualAsOf: '2026-08-24' }),
      freshness({ seriesId: 'us-nonfarm-payrolls', actualAsOf: '2026-07-01' }),
    ])
    expect(result).toEqual({ 'taiex-close': '2026-08-24', 'us-nonfarm-payrolls': '2026-07-01' })
  })

  // 突變 #3 的守門：actualAsOf 為 null 代表「當時這條序列一個點都沒有」，重建要回空陣列，
  // 不能因為值是 null 就把整個 key 略過（略過會讓 loadSnapshot 誤判成「沒有覆寫」而回退
  // 用 reportDate 去查，重新引入這次改動要修的漂移）。
  it('actualAsOf 為 null 的序列仍要保留 key（值為 null）、不能整筆略過', () => {
    const result = buildSeriesAsOf([
      freshness({ seriesId: 'foreign-taifex-net', actualAsOf: null }),
    ])
    expect('foreign-taifex-net' in result).toBe(true)
    expect(result['foreign-taifex-net']).toBeNull()
  })
})

describe('loadHistoricalSeriesAsOf', () => {
  it('原版 brief 有 dataFreshness：回 seriesAsOf/covered/missing', async () => {
    const dataFreshness = SERIES_SPECS.map(s => freshness({ seriesId: s.seriesId, actualAsOf: '2026-08-24' }))
    const getBrief = vi.fn(async () => ({ briefJson: { dataFreshness } }) as never)

    const result = await loadHistoricalSeriesAsOf('2026-08-24', { getBrief })

    expect(getBrief).toHaveBeenCalledWith('2026-08-24')
    expect(result).not.toBeNull()
    expect(result?.missing).toEqual([])
    expect(result?.covered).toHaveLength(SERIES_SPECS.length)
    expect(result?.seriesAsOf['taiex-close']).toBe('2026-08-24')
  })

  it('原版 brief 的 dataFreshness 少了幾條序列（那天之後才新增）：回報在 missing', async () => {
    const subset = SERIES_SPECS
      .filter(s => s.seriesId !== 'taiex-close')
      .map(s => freshness({ seriesId: s.seriesId, actualAsOf: '2026-08-24' }))
    const getBrief = vi.fn(async () => ({ briefJson: { dataFreshness: subset } }) as never)

    const result = await loadHistoricalSeriesAsOf('2026-08-24', { getBrief })

    expect(result?.missing).toEqual(['taiex-close'])
    expect(result?.covered).toHaveLength(SERIES_SPECS.length - 1)
  })

  it('找不到 brief：回 null', async () => {
    const getBrief = vi.fn(async () => null)
    const result = await loadHistoricalSeriesAsOf('2026-01-01', { getBrief })
    expect(result).toBeNull()
  })

  it('brief 存在但沒有 dataFreshness 欄位（2026-08-02 之前）：回 null', async () => {
    const getBrief = vi.fn(async () => ({ briefJson: { headline: 'h' } }) as never)
    const result = await loadHistoricalSeriesAsOf('2026-07-01', { getBrief })
    expect(result).toBeNull()
  })

  it('brief 存在但 dataFreshness 是空陣列：回 null（等同無可用底本）', async () => {
    const getBrief = vi.fn(async () => ({ briefJson: { dataFreshness: [] } }) as never)
    const result = await loadHistoricalSeriesAsOf('2026-07-01', { getBrief })
    expect(result).toBeNull()
  })

  it('briefJson 不合 schema（型別壞掉）：回 null 而非拋錯', async () => {
    const getBrief = vi.fn(async () => ({ briefJson: { dataFreshness: 'not-an-array' } }) as never)
    const result = await loadHistoricalSeriesAsOf('2026-07-01', { getBrief })
    expect(result).toBeNull()
  })

  it('briefJson 為 null（更早期的 row）：回 null', async () => {
    const getBrief = vi.fn(async () => ({ briefJson: null }) as never)
    const result = await loadHistoricalSeriesAsOf('2026-01-01', { getBrief })
    expect(result).toBeNull()
  })
})

describe('formatAsOfNotice', () => {
  it('可重建、無 missing：印覆蓋 N/N', () => {
    const total = SERIES_SPECS.length
    const msg = formatAsOfNotice('2026-08-24', {
      seriesAsOf: {},
      covered: SERIES_SPECS.map(s => s.seriesId),
      missing: [],
    })
    expect(msg).toBe(
      `[as-of] 2026-08-24：以原版 brief 的 dataFreshness 重建 ${total}/${total} 個序列的當時 as-of`
      + '（只還原日期；數值仍是現在 DB 的最新值，修正型序列可能是後來的修正版）',
    )
  })

  it('可重建、有 missing：附上回退清單', () => {
    const msg = formatAsOfNotice('2026-08-24', {
      seriesAsOf: {},
      covered: ['taiex-close'],
      missing: ['us-nonfarm-payrolls', 'foreign-taifex-net'],
    })
    expect(msg).toBe(
      '[as-of] 2026-08-24：以原版 brief 的 dataFreshness 重建 1/3 個序列的當時 as-of'
      + '；2 個序列無底本、回退到報告日：us-nonfarm-payrolls, foreign-taifex-net'
      + '（只還原日期；數值仍是現在 DB 的最新值，修正型序列可能是後來的修正版）',
    )
  })

  it('無法重建（result 為 null）：印警告訊息', () => {
    const msg = formatAsOfNotice('2026-07-01', null)
    expect(msg).toBe(
      '[as-of] 2026-07-01：沒有可用的原版 dataFreshness（那天沒有 brief，或它產於 2026-08-02 之前、還沒有這個欄位），'
      + '無法還原當時 as-of——快照可能含報告日之後才抓到的資料，grounding 類比較不可信',
    )
  })
})
