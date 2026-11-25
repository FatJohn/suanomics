import type { MarketBrief } from '@suanomics/shared'
import { MarketBriefDisclaimer } from '@suanomics/shared'

// judge 測試共用的最小 brief；只填 reader 面會讀到的欄位。
export function makeBrief(overrides: Partial<MarketBrief> = {}): MarketBrief {
  return {
    headline: '殖利率升破 5% 壓抑科技估值',
    summary: '美債 10 年期殖利率升至 5.1%，費半重挫 5.28%。',
    relatedNews: [],
    affectedIndustries: [],
    relatedETFs: [],
    reasoningChain: ['殖利率上行抬高折現率', '成長股估值承壓'],
    citations: [{ title: 'Fed 官員示警通膨', url: 'https://example.com/fed', quote: 'Fed 官員示警通膨走錯方向' }],
    disclaimer: MarketBriefDisclaimer,
    ...overrides,
  }
}
