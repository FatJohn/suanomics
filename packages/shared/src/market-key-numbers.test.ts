import { describe, expect, it } from 'vitest'
import { buildKeyNumbers, KEY_NUMBER_SERIES, MarketKeyNumbersResponseSchema, SECTION_TITLES } from './market-key-numbers.js'

// 首頁的 ribbon 與 mobile 的 strip 直接攤平 KEY_NUMBER_SERIES（沒有區標題可依靠），
// 只有側欄 rail 才按 section 分區。故「宣告序」本身就是讀者看到的順序、要釘死。
describe('key number 宣告序（＝攤平版的顯示序）', () => {
  it('shouldPlaceSoxFifthRightAfterUsdTwd', () => {
    expect(KEY_NUMBER_SERIES[4]?.seriesId).toBe('us-sox')
    expect(KEY_NUMBER_SERIES[4]?.label).toBe('費城半導體')
    expect(KEY_NUMBER_SERIES[4]?.section).toBe('us-equity')
    expect(KEY_NUMBER_SERIES[3]?.seriesId).toBe('usd-twd')
  })

  it('shouldKeepSectionsContiguousInTaiwanUsEquityRatesOrder', () => {
    const order: string[] = ['taiwan', 'us-equity', 'rates-markets']
    const idx = KEY_NUMBER_SERIES.map(s => order.indexOf(s.section))
    expect(idx).not.toContain(-1)
    // 非遞減 ⇒ 同 section 連續、且區序正確（攤平後不會出現「WTI 原油 → 費城半導體」）
    expect(idx).toEqual([...idx].sort((a, b) => a - b))
  })

  it('shouldHaveATitleForEverySectionUsed', () => {
    for (const spec of KEY_NUMBER_SERIES)
      expect(SECTION_TITLES[spec.section]).toBeTruthy()
  })
})

// 2026-06-15（一）：台股序列的期望 as-of ＝前一個交易日 06-12（五）。
const REPORT_DATE = '2026-06-15'

describe('buildKeyNumbers', () => {
  it('shouldMarkLevelSeriesUpWhenLatestExceedsPrevious', () => {
    const res = buildKeyNumbers({ 'taiex-close': [{ date: '2026-06-12', value: 23150 }, { date: '2026-06-11', value: 23000 }] }, REPORT_DATE)
    expect(res.series.find(s => s.seriesId === 'taiex-close')?.direction).toBe('up')
  })
  it('shouldMarkLevelSeriesDownWhenLatestBelowPrevious', () => {
    const res = buildKeyNumbers({ 'taiex-close': [{ date: '2026-06-12', value: 22800 }, { date: '2026-06-11', value: 23000 }] }, REPORT_DATE)
    expect(res.series.find(s => s.seriesId === 'taiex-close')?.direction).toBe('down')
  })
  it('shouldMarkLevelSeriesFlatWhenEqual', () => {
    const res = buildKeyNumbers({ 'taiex-close': [{ date: '2026-06-11', value: 23000 }, { date: '2026-06-11', value: 23000 }] }, REPORT_DATE)
    expect(res.series.find(s => s.seriesId === 'taiex-close')?.direction).toBe('flat')
  })
  it('shouldMarkLevelSeriesFlatAndNullPreviousWhenSinglePoint', () => {
    const res = buildKeyNumbers({ 'taiex-close': [{ date: '2026-06-11', value: 23000 }] }, REPORT_DATE)
    const t = res.series.find(s => s.seriesId === 'taiex-close')
    expect(t?.direction).toBe('flat')
    expect(t?.previous).toBeNull()
  })
  it('shouldMarkFlowSeriesUpWhenNetPositive', () => {
    const res = buildKeyNumbers({ 'taiex-institutional-net': [{ date: '2026-06-12', value: 125 }, { date: '2026-06-11', value: -50 }] }, REPORT_DATE)
    expect(res.series.find(s => s.seriesId === 'taiex-institutional-net')?.direction).toBe('up')
  })
  it('shouldMarkFlowSeriesDownWhenNetNegative', () => {
    const res = buildKeyNumbers({ 'taiex-institutional-net': [{ date: '2026-06-12', value: -80 }] }, REPORT_DATE)
    expect(res.series.find(s => s.seriesId === 'taiex-institutional-net')?.direction).toBe('down')
  })
  it('shouldMarkFlowSeriesFlatWhenNetZero', () => {
    const res = buildKeyNumbers({ 'taiex-institutional-net': [{ date: '2026-06-12', value: 0 }] }, REPORT_DATE)
    expect(res.series.find(s => s.seriesId === 'taiex-institutional-net')?.direction).toBe('flat')
  })
  it('shouldSkipSeriesWithNoData', () => {
    const res = buildKeyNumbers({ 'taiex-close': [{ date: '2026-06-11', value: 23000 }] }, REPORT_DATE)
    expect(res.series).toHaveLength(1)
    expect(res.series.find(s => s.seriesId === 'us-10y-yield')).toBeUndefined()
  })
  it('shouldSkipSeriesWithEmptyArray', () => {
    expect(buildKeyNumbers({ 'taiex-close': [] }, REPORT_DATE).series).toHaveLength(0)
  })
  it('shouldReturnEmptyForEmptyInput', () => {
    expect(buildKeyNumbers({}, REPORT_DATE).series).toEqual([])
  })
  it('shouldPreserveDeclarationOrderTaiwanFirst', () => {
    const res = buildKeyNumbers({
      'us-10y-yield': [{ date: '2026-06-12', value: 4.32 }],
      'taiex-close': [{ date: '2026-06-11', value: 23000 }],
    }, REPORT_DATE)
    expect(res.series.map(s => s.seriesId)).toEqual(['taiex-close', 'us-10y-yield'])
  })
  it('shouldProduceSchemaValidOutput', () => {
    const res = buildKeyNumbers({ 'taiex-close': [{ date: '2026-06-11', value: 23000 }] }, REPORT_DATE)
    expect(() => MarketKeyNumbersResponseSchema.parse(res)).not.toThrow()
  })
})

// 讀者面過去完全沒有 stale 判定——`usd-twd`（H.10、每週一發）與 `wti-oil`
// （Spot Prices、每週三發）每週固定有幾天卡片顯示的是好幾天前的值、且零標示。
describe('關鍵數字卡的落後判定', () => {
  it('準時的序列 fresh、無落後標籤', () => {
    const res = buildKeyNumbers({ 'taiex-close': [{ date: '2026-06-12', value: 23000 }] }, REPORT_DATE)
    expect(res.series[0]?.freshness.state).toBe('fresh')
    expect(res.series[0]?.lagLabel).toBeNull()
  })

  it('週頻的美元兌台幣在期望覆蓋日仍算 fresh（不因「距今 7 天」被誤判）', () => {
    // H.10 週一發、蓋到前一個週五：2026-06-15（一）的期望仍是 06-05（前前個週五）
    const res = buildKeyNumbers({ 'usd-twd': [{ date: '2026-06-05', value: 29.35 }] }, REPORT_DATE)
    expect(res.series[0]?.freshness.state).toBe('fresh')
    expect(res.series[0]?.lagLabel).toBeNull()
  })

  it('落後一個發布週期 → lagging + 中文標籤（讀者面要看得到）', () => {
    const res = buildKeyNumbers({ 'usd-twd': [{ date: '2026-05-29', value: 29.35 }] }, REPORT_DATE)
    expect(res.series[0]?.freshness.state).toBe('lagging')
    expect(res.series[0]?.lagLabel).toBe('落後 1 週')
  })

  it('落後一個交易日的美股序列標交易日單位', () => {
    // us-sox：2026-06-15（一）期望 06-12（五）；給 06-11 → 落後 1 個交易日
    const res = buildKeyNumbers({ 'us-sox': [{ date: '2026-06-11', value: 5432 }] }, REPORT_DATE)
    expect(res.series[0]?.lagLabel).toBe('落後 1 個交易日')
  })

  it('落後達硬上限仍照給數字與標籤（卡片不隱藏、與 LLM 那份 snapshot 的取捨不同）', () => {
    const res = buildKeyNumbers({ 'taiex-close': [{ date: '2026-06-08', value: 23000 }] }, REPORT_DATE)
    expect(res.series[0]?.freshness.state).toBe('stale')
    expect(res.series[0]?.lagLabel).toBe('落後 4 個交易日')
  })
})

// 讀者要問的是「這是哪一天的數字」，不是「來源有沒有遲到」——兩者會分岔，
// 而分岔處正是週頻序列（準時發布、但值本來就一週前）。
describe('isLatestTradingDay：讀者面要不要附日期', () => {
  it('前一個交易日的值 → true（不附日期、那是預設期待）', () => {
    const res = buildKeyNumbers({ 'taiex-close': [{ date: '2026-06-12', value: 23000 }] }, REPORT_DATE)
    expect(res.series[0]?.isLatestTradingDay).toBe(true)
  })

  it('週頻序列準時發布時仍為 false（fresh 但不是今天的數字）', () => {
    const res = buildKeyNumbers({ 'usd-twd': [{ date: '2026-06-05', value: 29.35 }] }, REPORT_DATE)
    expect(res.series[0]?.freshness.state).toBe('fresh')
    expect(res.series[0]?.lagLabel).toBeNull()
    // 只看 lagLabel 的話這格一個字都不會標——這正是要避免的
    expect(res.series[0]?.isLatestTradingDay).toBe(false)
  })

  it('結構性 T-2 的殖利率為 false（H.15 就是這樣發）', () => {
    const res = buildKeyNumbers({ 'us-10y-yield': [{ date: '2026-06-11', value: 4.32 }] }, REPORT_DATE)
    expect(res.series[0]?.freshness.state).toBe('fresh')
    expect(res.series[0]?.isLatestTradingDay).toBe(false)
  })

  it('遲到的美股序列：false 且帶落後標籤（日期與落後都要出現）', () => {
    const res = buildKeyNumbers({ 'us-sox': [{ date: '2026-06-11', value: 5432 }] }, REPORT_DATE)
    expect(res.series[0]?.isLatestTradingDay).toBe(false)
    expect(res.series[0]?.lagLabel).toBe('落後 1 個交易日')
  })
})
