import type { ItemCategory } from '../../db/news-categories.js'
import type { CategoryFloors } from './selection.js'
import { marketClosureBefore } from '../../agents/market-closure.js'
import { selectWithCategoryFloors } from './selection.js'

// 與 getRelevanceCandidates 的預設 sanity cap 相同；最長的春節連假也在這之內。
export const MAX_CANDIDATE_WINDOW_DAYS = 14

// 窗往回涵蓋到上一個交易日那次執行（台北 05:00＝前一天 21:00 UTC）抓到的新聞：
// 一般交易日曆日差 1 → 2 天，與改版前的固定窗相同。
export function windowDaysForGap(calendarDays: number): number {
  return Math.min(calendarDays + 1, MAX_CANDIDATE_WINDOW_DAYS)
}

export function candidateWindowDays(briefDate: string): number {
  return windowDaysForGap(marketClosureBefore(briefDate)?.calendarDays ?? 1)
}

interface Dated { publishedAt: Date | null, fetchedAt: Date }

const TAIPEI_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' })

function taipeiDateOf(c: Dated): string {
  return TAIPEI_DATE.format(c.publishedAt ?? c.fetchedAt)
}

// 休市後第一個交易日：候選依發布時間新到舊，直接取前 N 名會被當日新聞佔滿。
// 改成休市期間逐日輪流（新的日子先），上一個交易日之前的舊聞已在上一份報告，排最後。
export function spreadAcrossClosure<T extends Dated>(candidates: readonly T[], briefDate: string): readonly T[] {
  const closure = marketClosureBefore(briefDate)
  if (!closure)
    return candidates
  const byDay = new Map<string, T[]>()
  const older: T[] = []
  for (const c of candidates) {
    const day = taipeiDateOf(c)
    if (day < closure.previousTradingDay) {
      older.push(c)
      continue
    }
    byDay.set(day, [...(byDay.get(day) ?? []), c])
  }
  const queues = [...byDay.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([, items]) => items)
  const spread: T[] = []
  for (let round = 0; queues.some(q => round < q.length); round++) {
    for (const q of queues) {
      const next = q[round]
      if (next !== undefined)
        spread.push(next)
    }
  }
  return [...spread, ...older]
}

// 分散只用來決定誰入選；回傳仍維持輸入順序，editor 看到的候選照舊是新到舊。
export function selectAcrossClosure<T extends Dated & { category: ItemCategory }>(
  candidates: readonly T[],
  briefDate: string,
  options: { total: number, floors: CategoryFloors },
): T[] {
  const picked = new Set(selectWithCategoryFloors(spreadAcrossClosure(candidates, briefDate), options))
  return candidates.filter(c => picked.has(c))
}
