import type { FixtureManifest, FixtureProvenance } from './manifest.js'
import type { ShapeDrift } from './shape.js'
import { diffShape, hasBreakingDrift, shapeOf } from './shape.js'

// 現況取樣得比樣本深得多：樣本是人存的、只有幾筆，現況可能有幾百列。兩邊都用同一個小
// 上限的話，只出現在後段的稀疏欄位會讓「樣本有、現況沒有」變成假的 breaking。
const LIVE_SAMPLE = 500

// 樣本與現實的對照。
//
// 判定與 I/O 分開的理由不是美觀：這支工具自己的失敗模式就是「跑完了、數字合理、但是錯的」
// ——把 fetch 與檔案讀取注入進來，才驗得了「現況回空陣列時不要報成 6 個欄位不見了」這種
// 事，而那正是最容易誤報、然後讓整支工具被無視的那一格。

export type CheckStatus
  /** 形狀對得上（可能有 info 級的新欄位） */
  = | 'match'
  /** 有 breaking 級漂移：欄位不見、型別換掉、必填變選填 */
    | 'drift'
  /** 這一條不做自動比對（非 JSON、非 GET、或沒有對應 URL） */
    | 'skipped'
  /** 打不到對方 */
    | 'unreachable'
  /** 對方回空陣列：形狀無從比較，不是漂移 */
    | 'empty-live'

export interface CheckOutcome {
  label: string
  entry: FixtureProvenance
  status: CheckStatus
  drifts: ShapeDrift[]
  detail?: string
}

export interface CheckDeps {
  readFixture: (manifest: FixtureManifest, file: string) => string
  fetchLive: (url: string) => Promise<unknown>
}

function isEmptyArray(v: unknown): boolean {
  return Array.isArray(v) && v.length === 0
}

export async function checkEntry(
  manifest: FixtureManifest,
  entry: FixtureProvenance,
  deps: CheckDeps,
): Promise<CheckOutcome> {
  const base = { label: manifest.label, entry, drifts: [] as ShapeDrift[] }
  if (entry.kind !== 'json')
    return { ...base, status: 'skipped', detail: '非 JSON，只能人工重抓比對' }
  if (entry.url === null)
    return { ...base, status: 'skipped', detail: '通用結構範例，沒有可比對的來源 URL' }

  let live: unknown
  try {
    live = await deps.fetchLive(entry.url)
  }
  catch (err) {
    return { ...base, status: 'unreachable', detail: err instanceof Error ? err.message : String(err) }
  }

  // 空陣列是合法的日常結果（非交易日、當天沒有除權息），不是漂移。若不特判，樣本裡每個
  // 欄位都會被報成「現況沒有」——一次誤報就足以讓人以後直接忽略這支工具的輸出。
  if (isEmptyArray(live))
    return { ...base, status: 'empty-live', detail: '對方回空陣列（非交易日之類），形狀無從比較' }

  const fixtureRaw = deps.readFixture(manifest, entry.file)
  let fixtureValue: unknown
  try {
    fixtureValue = JSON.parse(fixtureRaw)
  }
  catch (err) {
    return { ...base, status: 'drift', detail: `樣本本身不是合法 JSON：${err instanceof Error ? err.message : String(err)}` }
  }

  const drifts = diffShape(shapeOf(fixtureValue), shapeOf(live, { sample: LIVE_SAMPLE }))
  return { ...base, entry, drifts, status: hasBreakingDrift(drifts) ? 'drift' : 'match' }
}

const STATUS_LABEL: Record<CheckStatus, string> = {
  'match': 'OK      ',
  'drift': 'DRIFT   ',
  'skipped': 'SKIP    ',
  'unreachable': 'NO-REACH',
  'empty-live': 'EMPTY   ',
}

export function formatReport(outcomes: readonly CheckOutcome[]): string[] {
  const lines: string[] = []
  for (const o of outcomes) {
    const originTag = o.entry.origin === 'synthetic' ? '手寫樣本' : o.entry.origin === 'unverified' ? '出處未核實' : '已擷取'
    const verified = o.entry.shapeVerifiedAt ? `・形狀 ${o.entry.shapeVerifiedAt} 對過` : '・形狀未對過'
    const origin = ` [${originTag}${verified}]`
    lines.push(`${STATUS_LABEL[o.status]} ${o.label}/${o.entry.file}${origin}${o.detail ? ` — ${o.detail}` : ''}`)
    for (const d of o.drifts)
      lines.push(`         ${d.severity === 'breaking' ? '!!' : '  '} ${d.path}：${d.detail}`)
  }
  const count = (s: CheckStatus): number => outcomes.filter(o => o.status === s).length
  const synthetic = outcomes.filter(o => o.entry.origin === 'synthetic').length
  const unverified = outcomes.filter(o => o.entry.origin === 'unverified').length
  lines.push('')
  // ★ 總結行一定要報「真的對到幾份」。只報 drift 數的話，全部打不到對方時最後一行會是
  //   「drift 0」——一眼讀起來像全過，實際上什麼都沒驗到。2026-08-22 驗收指出。
  lines.push(`共 ${outcomes.length} 份樣本：對到 ${count('match')}、drift ${count('drift')}、打不到 ${count('unreachable')}、空回應 ${count('empty-live')}、跳過 ${count('skipped')}`)
  lines.push(`出處：手寫 ${synthetic}、未核實 ${unverified}`)
  if (count('match') === 0 && count('drift') === 0)
    lines.push('!! 這一次沒有任何一份樣本真的跟現實對到——別把它讀成「全過」。')
  return lines
}

/** 只有 breaking 漂移算失敗。打不到對方不算——那是對方的事，不是樣本過期。 */
export function hasFailure(outcomes: readonly CheckOutcome[]): boolean {
  return outcomes.some(o => o.status === 'drift')
}
