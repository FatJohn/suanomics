import type { ItemCategory } from '../../db/news-categories.js'
import { ITEM_CATEGORIES } from '../../db/news-categories.js'

export type CategoryFloors = Partial<Record<ItemCategory, number>>

export const DEFAULT_SELECTION_TOTAL = 36

const DEFAULT_CATEGORY_FLOORS: Record<ItemCategory, number> = {
  'macro': 6,
  'geopolitics': 4,
  'industry': 6,
  'energy': 3,
  'disaster-health': 2,
  'other': 2,
}

function isItemCategory(value: string): value is ItemCategory {
  return (ITEM_CATEGORIES as readonly string[]).includes(value)
}

// 打錯的類別若被略過，等於該類保底靜默失效，所以整串一起驗。
export function parseCategoryFloors(raw: string | undefined): Record<ItemCategory, number> {
  const floors = { ...DEFAULT_CATEGORY_FLOORS }
  for (const entry of (raw ?? '').split(',').map(s => s.trim()).filter(Boolean)) {
    const [category = '', count = ''] = entry.split(':')
    if (!isItemCategory(category))
      throw new Error(`NEWS_CATEGORY_FLOORS 含未知類別：${category}`)
    if (!/^\d+$/.test(count))
      throw new Error(`NEWS_CATEGORY_FLOORS 名額應為非負整數，收到 ${entry}`)
    floors[category] = Number(count)
  }
  return floors
}

/** candidates 需已依優先序排好；回傳仍維持輸入順序。 */
export function selectWithCategoryFloors<T extends { category: ItemCategory }>(
  candidates: readonly T[],
  options: { total: number, floors: CategoryFloors },
): T[] {
  const floorSum = Object.values(options.floors).reduce((sum, n) => sum + n, 0)
  if (floorSum > options.total)
    throw new Error(`保底名額總和 ${floorSum} 超過 total ${options.total}`)

  const taken = new Set<number>()
  const used = new Map<ItemCategory, number>()
  candidates.forEach((candidate, index) => {
    const count = used.get(candidate.category) ?? 0
    if (count < (options.floors[candidate.category] ?? 0)) {
      taken.add(index)
      used.set(candidate.category, count + 1)
    }
  })
  // 候選不足保底的類別，空下的名額由這裡依序補給其他類。
  for (let index = 0; index < candidates.length && taken.size < options.total; index++)
    taken.add(index)
  return candidates.filter((_, index) => taken.has(index))
}
