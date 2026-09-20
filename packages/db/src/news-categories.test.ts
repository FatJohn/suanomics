import { describe, expect, it, vi } from 'vitest'
import {
  categoryForSlug,
  ITEM_CATEGORIES,
  ITEM_CATEGORY_LABEL,
  itemCategoryFromSource,
  partitionByCategory,
  resolveItemCategory,
} from './news-categories.js'

describe('categoryForSlug', () => {
  it('台股 feed slug → tw-equity', () => {
    expect(categoryForSlug('cna')).toBe('tw-equity')
    expect(categoryForSlug('google-news-cnyes')).toBe('tw-equity')
  })

  it('總經/能源 feed slug → macro', () => {
    expect(categoryForSlug('eia')).toBe('macro')
    expect(categoryForSlug('google-news-us-macro')).toBe('macro')
  })

  it('未知 slug → fallback macro（保守、不丟例外）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(categoryForSlug('does-not-exist')).toBe('macro')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('partitionByCategory', () => {
  const get = (x: { cat: string }) => x.cat

  it('每類取前 N 則、保持原順序（recency 交錯）', () => {
    const items = [
      { id: 1, cat: 'a' },
      { id: 2, cat: 'b' },
      { id: 3, cat: 'a' },
      { id: 4, cat: 'a' },
      { id: 5, cat: 'b' },
    ]
    const out = partitionByCategory(items, get, 2)
    // a 取前 2（id 1,3）、b 取前 2（id 2,5）、原順序保留
    expect(out.map(x => x.id)).toEqual([1, 2, 3, 5])
  })

  it('高產量類別不會灌爆另一類', () => {
    const items = [
      { id: 1, cat: 'a' },
      { id: 2, cat: 'a' },
      { id: 3, cat: 'a' },
      { id: 4, cat: 'b' },
    ]
    const out = partitionByCategory(items, get, 2)
    expect(out.filter(x => x.cat === 'a').length).toBe(2)
    expect(out.filter(x => x.cat === 'b').length).toBe(1)
  })

  it('某類不足 N 則時取全部（balance by availability）', () => {
    const items = [{ id: 1, cat: 'a' }, { id: 2, cat: 'b' }]
    const out = partitionByCategory(items, get, 5)
    expect(out.map(x => x.id)).toEqual([1, 2])
  })
})

describe('item category taxonomy', () => {
  it('every ItemCategory has a label', () => {
    for (const c of ITEM_CATEGORIES)
      expect(ITEM_CATEGORY_LABEL[c], `label for ${c}`).toBeTruthy()
  })
  it('itemCategoryFromSource maps the 2 source strata to coarse item buckets', () => {
    expect(itemCategoryFromSource('tw-equity')).toBe('tw-equity-other')
    expect(itemCategoryFromSource('macro')).toBe('macro')
  })
})

describe('resolveItemCategory', () => {
  it('uses a valid item category when present', () => {
    expect(resolveItemCategory('tech-semi', 'google-news-fin')).toBe('tech-semi')
  })
  it('falls back to source category when item category is null', () => {
    expect(resolveItemCategory(null, 'google-news-fin')).toBe('tw-equity-other')
    expect(resolveItemCategory(null, 'google-news-oil')).toBe('macro')
  })
  it('falls back when item category is an unknown string', () => {
    expect(resolveItemCategory('garbage', 'google-news-fin')).toBe('tw-equity-other')
  })
})
