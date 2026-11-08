/** 只收窗內的 feed 項目；官方 feed 動輒回數百則歷史稿，全收會讓正文抓取與 LLM 分類成本失控。 */
export function filterRecentEntries<T extends { publishedAt: Date | null }>(
  entries: readonly T[],
  now: Date,
  windowHours: number,
): T[] {
  const cutoff = now.getTime() - windowHours * 3_600_000
  return entries.filter(e => !e.publishedAt || e.publishedAt.getTime() >= cutoff)
}
