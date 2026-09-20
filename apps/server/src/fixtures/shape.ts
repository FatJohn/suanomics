// 回應「形狀」的擷取與比對。
//
// 為什麼是形狀而不是值：外部 API 的值每天都在變（今天的收盤價、今天的新聞），拿值比對
// 只會天天紅。真正會弄壞解析的是**欄位改名、消失、或型別變了**——那是形狀的事。
//
// 為什麼需要這個：這個 repo 的 firecrawl 事故就是 mock 自造了一個真實 API 不會回的形狀
// （`{ url, title, markdown }`，而 v1 /search 回的是 `description`），測試從第一天就是綠的，
// 驗的是「實作與 mock 之間的一致性」，不是「實作與真實 API 之間的一致性」。存下來的樣本
// 若沒有辦法跟現實重新對照，它跟自造形狀沒有分別——只是比較難發現。
//
// 形狀攤平成 path → { types, required } 的字典，不做巢狀樹：巢狀樹的 diff 難讀，而攤平之後
// 「哪一個欄位不見了」直接就是一行。

export interface ShapeEntry {
  /** 這個 path 上出現過的 JS 型別，排序去重。 */
  types: string[]
  /** 父層每次出現時，這個 path 都在＝required。陣列元素少一個欄位就會變 false。 */
  required: boolean
}

/** path → 形狀。root 是 ''，物件欄位是 `.key`，陣列元素是 `[]`。 */
export type Shape = Record<string, ShapeEntry>

/**
 * 陣列取樣上限。
 *
 * ★ 「取樣就夠了」不是恆真的：稀疏欄位若只出現在第 N+1 筆之後就會被漏掉，於是
 * 「樣本有、現況前 N 筆沒有」變成假的 breaking。所以 check 對**現況**用大得多的上限
 * （見 check.ts 的 LIVE_SAMPLE）——樣本本來就小，現況才是會有幾百列的那邊。
 */
const DEFAULT_SAMPLE = 20

function typeOf(v: unknown): string {
  if (v === null)
    return 'null'
  if (Array.isArray(v))
    return 'array'
  return typeof v
}

function parentOf(path: string): string | null {
  if (path === '')
    return null
  if (path.endsWith('[]'))
    return path.slice(0, -2)
  const dot = path.lastIndexOf('.')
  return dot < 0 ? '' : path.slice(0, dot)
}

export function shapeOf(value: unknown, opts?: { sample?: number }): Shape {
  const sample = opts?.sample ?? DEFAULT_SAMPLE
  const types = new Map<string, Set<string>>()
  const counts = new Map<string, number>()

  const visit = (v: unknown, path: string): void => {
    counts.set(path, (counts.get(path) ?? 0) + 1)
    const t = typeOf(v)
    let set = types.get(path)
    if (!set) {
      set = new Set()
      types.set(path, set)
    }
    set.add(t)

    if (t === 'array') {
      for (const el of (v as unknown[]).slice(0, sample))
        visit(el, `${path}[]`)
    }
    else if (t === 'object') {
      for (const [k, val] of Object.entries(v as Record<string, unknown>))
        visit(val, `${path}.${k}`)
    }
  }
  visit(value, '')

  const shape: Shape = {}
  for (const [path, set] of types) {
    const parent = parentOf(path)
    const parentCount = parent === null ? 1 : (counts.get(parent) ?? 0)
    // 陣列元素這個 path 本身沒有 required 可言：它的出現次數等於元素個數，拿去跟父層
    // 的次數比一定不相等，於是「兩筆資料」會被判成「只有部分筆有」。元素底下的欄位才
    // 是要判的——它們的父層正是 `[]`，次數就是元素個數，那個比較才有意義。
    const isArrayElement = path.endsWith('[]')
    shape[path] = {
      types: [...set].sort(),
      required: isArrayElement || (parentCount > 0 && (counts.get(path) ?? 0) === parentCount),
    }
  }
  return shape
}

export type DriftSeverity = 'breaking' | 'info'

export interface ShapeDrift {
  path: string
  severity: DriftSeverity
  detail: string
}

/**
 * 比對存下來的樣本與現況。
 *
 * **breaking 與 info 刻意分級**：欄位消失、型別完全換掉、原本必有變成偶爾才有——這些會
 * 弄壞解析。多出新欄位不會，把它報成 breaking 只會讓這支工具很快被無視。
 */
export function diffShape(fixture: Shape, live: Shape): ShapeDrift[] {
  const drifts: ShapeDrift[] = []
  for (const [path, expected] of Object.entries(fixture)) {
    const actual = live[path]
    if (!actual) {
      // 「現況那個陣列是空的」與「欄位不見了」要分開：非交易日的 TWSE、當天沒有除權息，
      // 都會讓某個陣列空掉，於是它底下的每個欄位都「不見了」。報成 breaking 是誤報，而
      // 一次誤報就足以讓人以後忽略這支工具。★ check.ts 另有 root 層的特判，這裡處理的是
      // 巢狀的那種（例如 legacy API 的 {stat, data: []}），2026-08-22 驗收指出。
      // 要一路上溯到「現況裡真的存在」的最近祖先：陣列一空，`.data[]` 自己也不存在，
      // 只上溯一層會找不到東西可判。
      let ancestor = parentOf(path)
      while (ancestor !== null && !(ancestor in live))
        ancestor = parentOf(ancestor)
      const parentIsEmptyArrayNow = ancestor !== null
        && live[ancestor]?.types.includes('array') === true
        && !(`${ancestor}[]` in live)
      drifts.push({
        path,
        severity: parentIsEmptyArrayNow ? 'info' : 'breaking',
        detail: parentIsEmptyArrayNow ? '現況該層是空陣列，形狀無從比較' : '樣本有這個欄位，現況沒有',
      })
      continue
    }
    const overlap = expected.types.filter(t => actual.types.includes(t))
    if (overlap.length === 0) {
      drifts.push({ path, severity: 'breaking', detail: `型別完全換掉：樣本 ${expected.types.join('|')} → 現況 ${actual.types.join('|')}` })
      continue
    }
    // 只看「有沒有交集」會放過一種真的會弄壞解析的漂移：欄位開始回 null。
    // 樣本是 ['string']、現況是 ['null','string'] 時交集非空，但呼叫端若沒有 null 檢查
    // 就會在那一筆炸掉。這一格是 2026-08-22 的獨立複查指出的。
    if (!expected.types.includes('null') && actual.types.includes('null')) {
      drifts.push({ path, severity: 'breaking', detail: '現況開始回 null，樣本從來沒有過' })
      continue
    }
    if (expected.required && !actual.required)
      drifts.push({ path, severity: 'breaking', detail: '樣本裡每筆都有，現況只有部分筆有' })
  }
  for (const path of Object.keys(live)) {
    if (!(path in fixture))
      drifts.push({ path, severity: 'info', detail: '現況多出來的欄位（樣本沒有）' })
  }
  return drifts.sort((a, b) => a.path.localeCompare(b.path))
}

export function hasBreakingDrift(drifts: readonly ShapeDrift[]): boolean {
  return drifts.some(d => d.severity === 'breaking')
}
