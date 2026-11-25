export interface SourceFetchDay {
  runDate: string
  failed: boolean
  httpStatus: number | null
}

export interface SourceFailureAlert {
  slug: string
  consecutive: number
  httpStatus: number | null
}

// ADR 0002：出口 IP 每次 run 可能不同，單次失敗是雜訊，連續失敗才算來源出問題。
export const CONSECUTIVE_FAILURE_THRESHOLD = 3

/** history 每個來源依日期新到舊。 */
export function findConsecutiveFailures(
  history: ReadonlyMap<string, readonly SourceFetchDay[]>,
  threshold: number,
): SourceFailureAlert[] {
  const alerts: SourceFailureAlert[] = []
  for (const [slug, days] of history) {
    const firstOk = days.findIndex(d => !d.failed)
    const consecutive = firstOk === -1 ? days.length : firstOk
    if (consecutive >= threshold)
      alerts.push({ slug, consecutive, httpStatus: days[0]?.httpStatus ?? null })
  }
  return alerts
}

// 目前沒有通知管道；GitHub Actions 會把 ::warning:: 顯示成 run 的 annotation。
export function formatSourceAlert(alert: SourceFailureAlert): string {
  const status = alert.httpStatus === null ? '無狀態碼' : `HTTP ${alert.httpStatus}`
  return `::warning title=新聞來源連續失敗::${alert.slug} 連續 ${alert.consecutive} 天失敗（${status}）`
}
