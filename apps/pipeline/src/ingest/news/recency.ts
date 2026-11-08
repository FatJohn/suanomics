// 非交易日不跑 ingest，窗要大於最長休市（2026 春節 02-12 到 02-22），否則連假期間的新聞永遠進不來。
export const FEED_WINDOW_HOURS = 14 * 24

/** 只收窗內的 feed 項目；官方 feed 動輒回數百則歷史稿，全收會讓正文抓取與 LLM 分類成本失控。 */
export function filterRecentEntries<T extends { publishedAt: Date | null }>(
  entries: readonly T[],
  now: Date,
  windowHours: number,
): T[] {
  const cutoff = now.getTime() - windowHours * 3_600_000
  return entries.filter(e => !e.publishedAt || e.publishedAt.getTime() >= cutoff)
}
