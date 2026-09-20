/**
 * `?date=` 從來不是這個站的參數——日期在路徑上（`/d/:date`，見 `router/index.ts`）。
 *
 * 但它看起來像有效的：`BriefLayerTabs` 切層時原本是用 `{ ...route.query }` 產生連結
 * （刻意保留既有 query，這樣 `?view=` 不會被洗掉），所以任何手打或被貼過來的 `?date=`
 * 都會一路跟著網址走，而 `HomeView` 只讀 `route.query.view`、從來沒人讀它。
 * 讀者換不到那天的報告，卻看到網址上明明寫著那天。
 *
 * 處理方式：合法日期就導到 canonical 路徑，不合法就只是把這個 key 拿掉——兩種情況
 * 網址上都不會再留著一個沒有作用的 `date`。
 *
 * `?view=` 是同一件事的另一半：`resolveReaderLayer` 把 `evidence` 以外的值一律當成報告層，
 * 而 `layerQuery` 刻意不在網址留 `?view=report`，所以 `?view=bogus` 與 `?view=report` 都會
 * 停在網址上卻沒有作用。這裡一併正規化掉——**只動站自己的參數**。
 *
 * `?foo=bar` 這種完全未知的參數不碰：我們沒有立場宣稱懂它（未來的 UTM／`?ref=` 就是這類）。
 * 它進站時留著，但不會沿著導覽擴散——切層與換日帶哪些 query 由 `reader-layer.ts` 的
 * `carriedQuery` 一處決定（曾經就是這兩條路徑各寫各的規則才壞掉）。要讓某個外部參數
 * 活過導覽，加在那個函式裡。
 *
 * 已知邊界：回傳的位置不帶 `hash`，所以這條 redirect 會吃掉 fragment。目前站上沒有任何錨點
 * （`rg 'route\.hash|location\.hash|scrollBehavior'` 在 `apps/web` 零命中），要加錨點時記得
 * 一起把 hash 帶過去。
 */

import type { LocationQuery, LocationQueryRaw } from 'vue-router'
import { layerQuery, resolveReaderLayer } from './reader-layer.js'

/** 只認 `YYYY-MM-DD`；日期本身合不合理（例如 02-31）交給後端，這裡只擋形狀。 */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** vue-router 的 query 值可能是 string、null，或重複 key 造成的陣列（同 `resolveReaderLayer`）。 */
function firstValue(raw: unknown): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw
  return typeof value === 'string' ? value : null
}

export interface ReaderRoute {
  name?: string | symbol | null | undefined
  path: string
  query: LocationQuery
}

export interface ReaderRouteTarget {
  path: string
  query: LocationQueryRaw
}

/** 只有讀者面的兩條路由需要處理；其他頁面的 query 不歸這裡管。 */
const HANDLED_ROUTES = new Set(['home', 'home-dated'])

/**
 * 回傳要導去哪裡，`null` 代表不用動。
 *
 * 兩個觸發條件，任一成立就會離開現在這個網址：
 * - query 裡有 `date`（合法就換路徑、不合法只是把 key 拿掉）。
 * - `view` 不是它正規化之後的樣子（`?view=bogus`、`?view=report`、重複 key 給出的陣列）。
 *
 * 兩個都不成立就回 `null`——`?view=evidence` 與完全沒有這兩個 key 的網址都走這條，
 * 不要讓每次導覽都多一次 replace。
 */
export function resolveReaderRouteRedirect(route: ReaderRoute): ReaderRouteTarget | null {
  if (!HANDLED_ROUTES.has(String(route.name ?? '')))
    return null

  const hasDate = Object.hasOwn(route.query, 'date')
  const rawView = route.query.view
  // `evidence` 留下、其餘（含預設層）都不該出現在網址上，`layerQuery` 用 undefined 表達「拿掉」
  const nextView = layerQuery(resolveReaderLayer(rawView)).view
  // 陣列一律算「要改」：即使第一個值合法，重複 key 本身就不是正規化後的樣子
  const viewChanged = Object.hasOwn(route.query, 'view')
    && (Array.isArray(rawView) || firstValue(rawView) !== nextView)

  if (!hasDate && !viewChanged)
    return null

  const { date: _date, view: _view, ...rest } = route.query
  const query: LocationQueryRaw = nextView === undefined ? rest : { ...rest, view: nextView }
  const date = firstValue(route.query.date)
  return {
    path: hasDate && date !== null && ISO_DATE.test(date) ? `/d/${date}` : route.path,
    query,
  }
}
