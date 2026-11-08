import type { FreshnessRule } from './market-freshness.js'
import type { SeriesKind, SeriesPoint } from './series-direction.js'
import { z } from 'zod'
import { classifyFreshness, formatLagLabel, previousTradingDay, SeriesFreshnessSchema } from './market-freshness.js'
import { computeSeriesDirection } from './series-direction.js'

export type KeyNumberSection = 'taiwan' | 'us-equity' | 'rates-markets'
/** 語意見 `series-direction.ts`；這裡保留舊名，呼叫端不必跟著改。 */
export type KeyNumberKind = SeriesKind

export interface KeyNumberSpec {
  seriesId: string
  label: string
  unit: string
  section: KeyNumberSection
  // level：方向＝與前值差；flow（如三大法人買賣超）：值本身即買超(+)/賣超(-)、方向＝值正負。
  kind: KeyNumberKind
  /**
   * 發布節奏。與 worker `SERIES_SPECS` 同序列的 `freshness` 必須一致——這裡是刻意的複製
   * （shared 不能依賴 worker），漂移由 `series-config.test.ts` 的守衛測試擋，比照 `kind`。
   */
  freshness: FreshnessRule
}

// curated 表現層清單（宣告序＝輸出序：台股 → 美股 → 全球利率）。
// label 為卡片自有（DRY 留 follow-up、不 reuse worker SERIES_SPECS）。
// **宣告序即攤平序**：MarketKeyNumbers.vue 只有 rail 版按 section 分區，首頁用的 ribbon
// 與 mobile 的 strip 都直接攤平本陣列——故新序列必須插在對應 section 的位置上，
// 否則攤平版會出現「WTI 原油 → 費城半導體」這種與 rail 區序矛盾的排列。
export const KEY_NUMBER_SERIES: readonly KeyNumberSpec[] = [
  { seriesId: 'taiex-close', label: '加權指數', unit: '點', section: 'taiwan', kind: 'level', freshness: { cadence: 'trading-daily', market: 'tw', lagTradingDays: 1 } },
  { seriesId: 'taiex-institutional-net', label: '三大法人買賣超', unit: '億元', section: 'taiwan', kind: 'flow', freshness: { cadence: 'trading-daily', market: 'tw', lagTradingDays: 1 } },
  { seriesId: 'taiex-margin-balance', label: '融資餘額', unit: '億元', section: 'taiwan', kind: 'level', freshness: { cadence: 'trading-daily', market: 'tw', lagTradingDays: 1 } },
  { seriesId: 'usd-twd', label: '美元兌台幣', unit: '元', section: 'taiwan', kind: 'level', freshness: { cadence: 'weekly', releaseDow: 1, coverageLagDays: 3 } },
  { seriesId: 'us-sox', label: '費城半導體', unit: '點', section: 'us-equity', kind: 'level', freshness: { cadence: 'trading-daily', market: 'us', lagTradingDays: 1 } },
  { seriesId: 'us-10y-yield', label: '美債 10 年期殖利率', unit: '%', section: 'rates-markets', kind: 'level', freshness: { cadence: 'trading-daily', market: 'us', lagTradingDays: 2 } },
  { seriesId: 'wti-oil', label: 'WTI 原油', unit: '美元', section: 'rates-markets', kind: 'level', freshness: { cadence: 'weekly', releaseDow: 3, coverageLagDays: 2 } },
]

export const SECTION_TITLES: Record<KeyNumberSection, string> = {
  'taiwan': '台股',
  'us-equity': '美股',
  'rates-markets': '全球利率',
}

const PointSchema = z.object({ date: z.string(), value: z.number() })

export const KeyNumberSchema = z.object({
  seriesId: z.string(),
  label: z.string(),
  unit: z.string(),
  section: z.enum(['taiwan', 'us-equity', 'rates-markets']),
  kind: z.enum(['level', 'flow']),
  direction: z.enum(['up', 'down', 'flat']),
  latest: PointSchema,
  previous: PointSchema.nullable(),
  // 這筆數字是不是最近一期。fresh 以外的狀態讀者面要標出來——`usd-twd` 與
  // `wti-oil` 走週頻發布，每週固定有幾天卡片顯示的是好幾天前的值。
  freshness: SeriesFreshnessSchema,
  // 落後幾期的中文措辭（如「落後 1 週」）。fresh／missing／unknown 為 null。
  lagLabel: z.string().nullable(),
  /**
   * 這筆值是不是「該市場最近一個交易日」的。false ⇒ 讀者面要附上資料日期。
   *
   * 為什麼不能只看 lagLabel：`lagLabel` 答的是「來源有沒有遲到」，而週頻序列準時發布時
   * 本來就一週才更新一次——美元兌台幣在週五顯示的是上週五的匯率、狀態是 fresh、卻仍然
   * 不是今天的數字。讀者要問的是「這是哪一天的」，兩件事不一樣。
   */
  isLatestTradingDay: z.boolean(),
})
export type KeyNumber = z.infer<typeof KeyNumberSchema>

export const MarketKeyNumbersResponseSchema = z.object({ series: z.array(KeyNumberSchema) })
export type MarketKeyNumbersResponse = z.infer<typeof MarketKeyNumbersResponseSchema>

// pointsBySeriesId：每序列最新在前（points[0] 最新、points[1] 前值），比照 getLatestPoints desc 排序。
// 無資料序列（key 缺或空陣列）跳過（graceful degrade）。
export function buildKeyNumbers(
  pointsBySeriesId: Record<string, SeriesPoint[]>,
  reportDate: string,
): MarketKeyNumbersResponse {
  const series: KeyNumber[] = []
  for (const spec of KEY_NUMBER_SERIES) {
    const points = pointsBySeriesId[spec.seriesId]
    const latest = points?.[0]
    if (!latest)
      continue
    const previous = points[1] ?? null
    const freshness = classifyFreshness({
      seriesId: spec.seriesId,
      rule: spec.freshness,
      reportDate,
      actualAsOf: latest.date,
    })
    series.push({
      seriesId: spec.seriesId,
      label: spec.label,
      unit: spec.unit,
      section: spec.section,
      kind: spec.kind,
      direction: computeSeriesDirection(spec.kind, latest, previous),
      latest: { date: latest.date, value: latest.value },
      previous: previous ? { date: previous.date, value: previous.value } : null,
      freshness,
      lagLabel: freshness.lagCycles != null && freshness.lagCycles > 0
        ? formatLagLabel(spec.freshness, freshness.lagCycles)
        : null,
      // 週頻／月頻依定義不可能是「最近一個交易日」的值、恆為 false。
      isLatestTradingDay: spec.freshness.cadence === 'trading-daily'
        && latest.date === previousTradingDay(reportDate, spec.freshness.market),
    })
  }
  return MarketKeyNumbersResponseSchema.parse({ series })
}
