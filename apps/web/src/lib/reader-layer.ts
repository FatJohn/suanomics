/**
 * 讀者面的兩層。
 *
 * 第一層是今天要讀的東西，第二層是「有興趣再追」的佐證。分層的理由是資訊層級，
 * 不是頁高——實測要收進第二層的三塊在 2560 只佔 593px（連動與來源本來就是收合的
 * accordion），頁高的一半是長文本身。
 *
 * 層別放在網址的 `?view=` 而不是元件狀態：讀者要能把「這天的佐證」直接貼給別人，
 * 上一頁也該回到他來的那一層。
 */

import type { LocationQuery, LocationQueryRaw } from 'vue-router'

export type ReaderLayer = 'report' | 'evidence'

export const DEFAULT_LAYER: ReaderLayer = 'report'

export const READER_LAYERS: ReadonlyArray<{ id: ReaderLayer, label: string }> = [
  { id: 'report', label: '今日報告' },
  { id: 'evidence', label: '佐證與來源' },
]

/** vue-router 的 query 值可能是 string、null，或重複 key 造成的陣列。 */
export function resolveReaderLayer(raw: unknown): ReaderLayer {
  const value = Array.isArray(raw) ? raw[0] : raw
  return value === 'evidence' ? 'evidence' : DEFAULT_LAYER
}

/**
 * 預設層不在網址留 `?view=report`——留了會讓分享出去的連結看起來像特例。
 * `undefined` 是 vue-router 移除該 query key 的寫法。
 */
export function layerQuery(layer: ReaderLayer): { view: string | undefined } {
  return { view: layer === DEFAULT_LAYER ? undefined : layer }
}

/**
 * 讀者面導覽要帶過去的 query——**切層與換日共用的單一決定點**。
 *
 * 目前站自己認得的參數只有 `view`，所以結果就是 `layerQuery`。這個函式存在的理由是
 * 把「導覽時該帶哪些 query」收成一處：在它之前，切層帶白名單、換日（`BriefDateSwitcher`
 * 的 `router.push` 只給路徑）什麼都不帶，於是在佐證層按上一天會被丟回報告層。
 * 兩條路徑各寫各的規則，而 `apps/web` 沒有 DOM 測試環境、這種不一致沒有東西擋得住。
 *
 * `layer` 不給就沿用網址上現在那層（換日、fallback 連結）；給了就是切層。
 * 未來要帶別的參數（UTM／`?ref=`）加在這裡，兩條路徑會一起拿到。
 */
export function carriedQuery(query: LocationQuery, layer?: ReaderLayer): LocationQueryRaw {
  return layerQuery(layer ?? resolveReaderLayer(query.view))
}
