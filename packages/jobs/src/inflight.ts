import type { JobKind } from './types.js'
import { JOB_INFLIGHT_STALENESS_MS } from './types.js'

// inflight row 的判定抽成純函式的理由不是美觀，是**防止兩份實作漂移**：
// audit.ts 有 fake 與真 Drizzle 兩條路徑，原本各自寫一次 staleness 比較。fake 那條被
// 測試覆蓋、真的那條沒有，改一邊另一邊照樣全綠（這個 repo 已經為同型的事付過代價）。
// 現在兩條都呼叫這裡，邊界只有一份。

export interface InflightRowShape {
  jobKind: JobKind
  createdAt?: Date | null
  startedAt?: Date | null
}

/**
 * 這筆 inflight row 已經「活了」多久。
 *
 * 用 startedAt 優先、createdAt 墊底：status='active' 的 row 要量的是**實際執行時間**，
 * 而不是含排隊等待的總時長——concurrency 是 1 的 kind（daily-brief、podcast-tts…）
 * 排在後面的 job 光是等就可能超過窗，用 createdAt 會把健康的排隊 job 判成孤兒。
 * status='queued' 的 row 沒有 startedAt，量到的就是等待時間，那正是它該被量的東西
 * （等太久的 queued row 多半是跑它的 process 消失了）。
 */
export function inflightAgeMs(row: InflightRowShape, now: number): number {
  const anchor = row.startedAt ?? row.createdAt
  if (!anchor)
    return 0
  return now - anchor.getTime()
}

/** 超過該 kind 的窗＝當成孤兒。窗的取值與依據見 types.ts 的 JOB_INFLIGHT_STALENESS_MS。 */
export function isOrphanedInflight(row: InflightRowShape, now: number): boolean {
  const limit = JOB_INFLIGHT_STALENESS_MS[row.jobKind]
  if (limit === undefined)
    return false
  return inflightAgeMs(row, now) > limit
}

/** 標成 failed 時寫進 error_message 的字串。要讓事後查 DB 的人看得出這不是 job 自己失敗的。 */
export function orphanErrorMessage(row: InflightRowShape, now: number): string {
  const minutes = Math.round(inflightAgeMs(row, now) / 60_000)
  return `orphaned: inflight ${minutes}m with no completion recorded (the process running it was likely killed)`
}

export interface IdentifiedInflightRow extends InflightRowShape {
  id?: string
}

/**
 * 最新那筆還活著就是 inflight，其餘過窗的都是孤兒。rows 必須已按 createdAt 由新到舊排序。
 *
 * 泛型而不吃 AuditRowShape 是為了不從這裡 import audit.ts（那會形成循環）；
 * 判定需要的欄位就是 InflightRowShape 那三個。
 */
export function partitionInflight<T extends InflightRowShape>(rows: T[], now: number): { fresh: T | null, orphans: T[] } {
  return {
    fresh: rows.find(r => !isOrphanedInflight(r, now)) ?? null,
    orphans: rows.filter(r => isOrphanedInflight(r, now)),
  }
}
