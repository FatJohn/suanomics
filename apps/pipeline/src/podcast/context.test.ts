import { describe, expect, it } from 'vitest'
import { buildMarketCloseFraming } from '../agents/market-close-framing.js'
import { podcastContextFromRunInputs } from './context.js'

describe('podcastContextFromRunInputs', () => {
  it('從 run_inputs 取市場、行事曆與敘事線素材，收盤時間框架依報告日重算', () => {
    const runInputs = {
      version: 1,
      editor: { storylineBlock: '## 追蹤線' },
      market: { snapshotBlock: '## 今日市場數據', calendarBlock: '## 本週財經行事曆', taiexCloseDate: '2026-11-25' },
    }
    expect(podcastContextFromRunInputs(runInputs, '2026-11-26')).toEqual({
      storylineBlock: '## 追蹤線',
      marketSnapshot: '## 今日市場數據',
      calendarBlock: '## 本週財經行事曆',
      marketCloseFraming: buildMarketCloseFraming('2026-11-25', '2026-11-26'),
    })
  })

  it('run_inputs 缺或形狀不符時各欄退回 null，不擋寫稿', () => {
    const empty = { storylineBlock: null, marketSnapshot: null, calendarBlock: null, marketCloseFraming: null }
    expect(podcastContextFromRunInputs(null, '2026-11-26')).toEqual(empty)
    expect(podcastContextFromRunInputs({ version: 1, editor: 3, market: { snapshotBlock: 5 } }, '2026-11-26')).toEqual(empty)
  })
})
