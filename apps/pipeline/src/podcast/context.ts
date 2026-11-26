import { buildMarketCloseFraming } from '../agents/market-close-framing.js'

export interface PodcastContext {
  storylineBlock: string | null
  marketSnapshot: string | null
  calendarBlock: string | null
  marketCloseFraming: string | null
}

function field(obj: unknown, key: string): unknown {
  return typeof obj === 'object' && obj !== null ? (obj as Record<string, unknown>)[key] : undefined
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

// 寫稿素材取自 brief 當時的輸入，不重新抓：重抓的市場數據可能已跟 brief 引用的不同。
// 一手公告刻意不帶：podcast 改寫的是已完成的 brief，多餵會引用到 brief 沒有的出處。
export function podcastContextFromRunInputs(runInputs: unknown, briefDate: string): PodcastContext {
  const market = field(runInputs, 'market')
  const taiexCloseDate = stringOrNull(field(market, 'taiexCloseDate'))
  return {
    storylineBlock: stringOrNull(field(field(runInputs, 'editor'), 'storylineBlock')),
    marketSnapshot: stringOrNull(field(market, 'snapshotBlock')),
    calendarBlock: stringOrNull(field(market, 'calendarBlock')),
    marketCloseFraming: stringOrNull(buildMarketCloseFraming(taiexCloseDate, briefDate)),
  }
}
