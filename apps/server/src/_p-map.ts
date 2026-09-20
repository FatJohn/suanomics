// Bounded-concurrency parallel map.
// 沿用 packages/prompt-research/src/sources/dispatch-helpers.ts 的 pattern。
// 若有第三處需求、考慮搬到 @suanomics/shared 統一。
//
// 設計：N 個 worker 並行從 shared index pull、保證最多 limit 個 fn(item) 同時 in-flight。
// 順序保留（out[idx]）以利下游 reduce / 聚合不被 race。

export async function pMap<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (limit <= 0)
    throw new Error('pMap: limit must be > 0')
  const out: R[] = Array.from({ length: items.length })
  let i = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (true) {
        const idx = i++
        if (idx >= items.length)
          return
        // eslint-disable-next-line ts/no-non-null-assertion -- idx < items.length guaranteed by guard above
        out[idx] = await fn(items[idx]!, idx)
      }
    }),
  )
  return out
}

export type Settled<T> = { status: 'fulfilled', value: T } | { status: 'rejected', reason: unknown }

// pMap 遇到 reject 會讓整批 reject（跟 Promise.all 同語意）。orchestrator.ts 的幾處扇出
// 原本靠 Promise.allSettled 讓單一失敗不中斷整批，換成 pMap 拿並行上限的同時要保留那個
// 容錯——這裡把「呼叫 fn、吞例外、包成 settled-like 形狀」抽成共用 wrapper，
// 避免三處各自重複同一段 try/catch。
export async function pMapSettled<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<Settled<R>[]> {
  return pMap(items, limit, async (item, index) => {
    try {
      const value = await fn(item, index)
      return { status: 'fulfilled', value } as const
    }
    catch (reason) {
      return { status: 'rejected', reason } as const
    }
  })
}
