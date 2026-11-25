import { describe, expect, it } from 'vitest'
import { isTwseListedIndustry, TWSE_LISTED_INDUSTRIES } from './twse-industries.js'

describe('twse listed industries', () => {
  it('收錄證交所上市股票的 32 個產業別，不重複', () => {
    expect(TWSE_LISTED_INDUSTRIES).toHaveLength(32)
    expect(new Set(TWSE_LISTED_INDUSTRIES).size).toBe(32)
  })
})

describe('isTwseListedIndustry', () => {
  it('產業別原文才算', () => {
    expect(isTwseListedIndustry('半導體業')).toBe(true)
    expect(isTwseListedIndustry('金融保險業')).toBe(true)
  })

  it('簡稱、組合名與美國分類用語都不算', () => {
    for (const name of ['半導體', '半導體與AI供應鏈', '房地產與 REITs', 'Semiconductors', ' 半導體業'])
      expect(isTwseListedIndustry(name), name).toBe(false)
  })
})
