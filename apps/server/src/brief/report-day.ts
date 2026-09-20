// 週日報告日 → 該週交易區間（週一 sunday−6、週五 sunday−2）。僅在 sunday 呼叫。
// isoDateMinusDays 沿用 storylines-repo 既有純函式、避免重複實作日期運算。
// 星期/假日分類已上移 @suanomics/shared 的 classifyPublicationDay（worker 與 api 共用）。
import { isoDateMinusDays } from '@suanomics/db/repos/storylines-repo'

export function weekBounds(sundayDate: string): { start: string, end: string } {
  return { start: isoDateMinusDays(sundayDate, 6), end: isoDateMinusDays(sundayDate, 2) }
}
