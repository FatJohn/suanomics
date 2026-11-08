import { SEED } from './seed.js'

export type NewsCategory = 'tw-equity' | 'macro'

// slug → category，由 SEED 的 category 欄位導出（單一事實來源：加來源時 TS 強制標 category）
export const SOURCE_CATEGORY: Record<string, NewsCategory> = Object.fromEntries(
  SEED.map(s => [s.slug, s.category] as const),
)

// 未知 slug（理論上不該發生：news_items 都來自 SEED 來源）保守 fallback macro + warn，
// 不丟例外——選題是加值層、不該因分類缺漏中斷 brief。
export function categoryForSlug(slug: string): NewsCategory {
  const category = SOURCE_CATEGORY[slug]
  if (category === undefined) {
    console.warn(`[news-categories] 未知來源 slug「${slug}」、fallback macro`)
    return 'macro'
  }
  return category
}

// 候選池分層：input 已按 recency 排序、每類保留前 perCategoryLimit 則、保持原順序。
// 純函式、generic：getCategory 取出每項分類。
export function partitionByCategory<T>(
  items: readonly T[],
  getCategory: (item: T) => string,
  perCategoryLimit: number,
): T[] {
  const counts = new Map<string, number>()
  const out: T[] = []
  for (const item of items) {
    const cat = getCategory(item)
    const n = counts.get(cat) ?? 0
    if (n < perCategoryLimit) {
      out.push(item)
      counts.set(cat, n + 1)
    }
  }
  return out
}

// ── item 層細分類（ingestion LLM 打標、存 news_items.category）──
export type ItemCategory = 'tech-semi' | 'tw-equity-other' | 'macro' | 'energy' | 'international'

export const ITEM_CATEGORIES: readonly ItemCategory[] = [
  'tech-semi',
  'tw-equity-other',
  'macro',
  'energy',
  'international',
]

export const ITEM_CATEGORY_LABEL: Record<ItemCategory, string> = {
  'tech-semi': '科技半導體',
  'tw-equity-other': '台股其他',
  'macro': '總經',
  'energy': '能源',
  'international': '國際',
}

// 來源層 2-strata → item 層粗桶（item category 為 null 時的退路）。
// 注意：energy / international 無法從來源層細分、null 時暫歸 macro、待 ingestion item 打標補上。
export function itemCategoryFromSource(sourceCat: NewsCategory): ItemCategory {
  return sourceCat === 'tw-equity' ? 'tw-equity-other' : 'macro'
}

// 選題時取 item category：DB 有合法值就用、否則退來源層（slug → 來源 category → 粗桶）
export function resolveItemCategory(itemCategory: string | null, slug: string): ItemCategory {
  if (itemCategory !== null && (ITEM_CATEGORIES as readonly string[]).includes(itemCategory))
    return itemCategory as ItemCategory
  return itemCategoryFromSource(categoryForSlug(slug))
}
