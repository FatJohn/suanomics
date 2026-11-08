// 補跑歷史日期時，market_data_points 的 as-of 只能靠原版 brief 自己記下來的
// `dataFreshness[].actualAsOf` 還原——`fetched_at` 每輪 refresh 被整批推新，用它反推
// 「當時 DB 有哪些點」只有 4/26 個序列能重現真值（2026-09-08 本機實測），比不還原還糟。
// 這裡把「讀原版 brief → 逐序列 as-of map」這件事收成一個純函式 + 一個薄載入器，
// 讓 `loadMarketContext` 的呼叫端（brief:rerun／brief:quality）各自決定要不要覆寫。
import type { SeriesFreshness } from '@suanomics/shared'
import { getDailyBriefByDate } from '@suanomics/db/repos/news-repo'
import { SeriesFreshnessSchema } from '@suanomics/shared'
import { z } from 'zod'
import { SERIES_SPECS } from './series-config.js'

/**
 * key＝seriesId，值＝該序列的 as-of 上界（含當日）。
 * 值為 `null` 代表「當時這條序列一個點都沒有」——重建時要回空陣列，不是回退到 reportDate；
 * key 不存在則代表「這條序列沒有底本可查」，由呼叫端決定回退（見 `loadSnapshot`）。
 */
export type SeriesAsOfMap = Record<string, string | null>

/** 逐筆取 seriesId → actualAsOf。`actualAsOf` 為 null 的序列仍要保留 key，不可略過。 */
export function buildSeriesAsOf(dataFreshness: readonly SeriesFreshness[]): SeriesAsOfMap {
  const map: SeriesAsOfMap = {}
  for (const f of dataFreshness)
    map[f.seriesId] = f.actualAsOf
  return map
}

export interface HistoricalAsOf {
  seriesAsOf: SeriesAsOfMap
  /** SERIES_SPECS 裡、原版 dataFreshness 有記錄到的 seriesId。 */
  covered: string[]
  /** SERIES_SPECS 裡、原版 dataFreshness 沒記錄到的 seriesId（例：那天之後才新增的序列）——這些會回退到 reportDate。 */
  missing: string[]
}

const DataFreshnessArraySchema = z.array(SeriesFreshnessSchema)

interface LoadHistoricalSeriesAsOfDeps {
  /** 注入點只為了讓測試不打 DB（同 market-data/context.ts 的 LoadDeps 慣例）。 */
  getBrief?: typeof getDailyBriefByDate
}

/**
 * 讀某天的原版 brief、還原它產出當下逐序列看到的 as-of。
 * 回 null 代表無法重建（沒有 brief、沒有 dataFreshness 欄位、或欄位為空陣列）——
 * 呼叫端此時應照舊繼續（不覆寫、退回現行 reportDate 上界）並印出警告。
 */
export async function loadHistoricalSeriesAsOf(
  date: string,
  deps: LoadHistoricalSeriesAsOfDeps = {},
): Promise<HistoricalAsOf | null> {
  const getBrief = deps.getBrief ?? getDailyBriefByDate
  const row = await getBrief(date)
  if (!row)
    return null

  const briefJson = row.briefJson
  const rawDataFreshness = briefJson !== null && typeof briefJson === 'object' && 'dataFreshness' in briefJson
    ? (briefJson as { dataFreshness: unknown }).dataFreshness
    : undefined
  const parsed = DataFreshnessArraySchema.safeParse(rawDataFreshness)
  if (!parsed.success || parsed.data.length === 0)
    return null

  const seriesAsOf = buildSeriesAsOf(parsed.data)
  const coveredSet = new Set(parsed.data.map(f => f.seriesId))
  const currentIds = SERIES_SPECS.map(s => s.seriesId)
  return {
    seriesAsOf,
    covered: currentIds.filter(id => coveredSet.has(id)),
    missing: currentIds.filter(id => !coveredSet.has(id)),
  }
}

/** 給使用者看的一行摘要，`brief:rerun`／`brief:quality` 各自決定用 console.log 還是 console.warn 印。 */
export function formatAsOfNotice(date: string, result: HistoricalAsOf | null): string {
  if (!result) {
    // 三種情形（那天沒有 brief row／brief 產於 2026-08-02 之前還沒有這個欄位／欄位是空陣列）
    // 都回 null，這裡不指定是哪一種——寫死其中一種歸因會在另外兩種情形下印出假的原因。
    return `[as-of] ${date}：沒有可用的原版 dataFreshness（那天沒有 brief，或它產於 2026-08-02 之前、還沒有這個欄位），`
      + '無法還原當時 as-of——快照可能含報告日之後才抓到的資料，grounding 類比較不可信'
  }
  const total = result.covered.length + result.missing.length
  const base = `[as-of] ${date}：以原版 brief 的 dataFreshness 重建 ${result.covered.length}/${total} 個序列的當時 as-of`
  const fallback = result.missing.length === 0
    ? ''
    : `；${result.missing.length} 個序列無底本、回退到報告日：${result.missing.join(', ')}`
  // 「重建 26/26」讀起來像素材完全還原，但還原的只有日期：值會被 upsert 就地覆蓋
  // （`market-data-repo.ts` 的 `set: { value: excluded.value }`），修正型序列（CPI、非農）
  // 拿到的是後來的修正版。這句提醒要跟著數字走，不能只寫在文件裡。
  return `${base}${fallback}（只還原日期；數值仍是現在 DB 的最新值，修正型序列可能是後來的修正版）`
}
