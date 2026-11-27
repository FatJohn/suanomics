import type { MarketBrief } from '@suanomics/shared'
import { describe, expect, it } from 'vitest'
import { NARRATIVE_WRITER_SYSTEM_PROMPT } from '../prompts/narrative-writer.prompt.js'
import { buildMarketCloseFraming } from './market-close-framing.js'
import { formatUserContent } from './narrative-writer.js'

// #122：用 2026-11-26 報告的市場資料形狀（加權指數停在 11/24、融資餘額到 11/25、
// 2 年期 4.63% 高於 Fed funds 3.88%）釘住送給 narrative-writer 的輸入。
// 只證明模型拿到的指示；模型輸出要靠重跑真 LLM 才看得到。
const SNAPSHOT_2026_11_26 = [
  '## 今日市場數據',
  '- 加權指數：40,122 點（11/24、前值 36,812 點、+8.99%）',
  '- 融資餘額：4,341 億元（11/25、前值 4,535 億元、-4.27%）',
  '- 美債 2 年期殖利率：4.63%（11/24）',
  '- Fed funds 利率：3.88%（10 月）',
].join('\n')

const BRIEF: MarketBrief = {
  headline: 'h',
  summary: 's',
  relatedNews: [],
  affectedIndustries: [],
  relatedETFs: [],
  reasoningChain: ['r'],
  citations: [],
  disclaimer: '本分析僅供參考、非投資建議、實際投資請諮詢專業人士',
}

describe('2026-11-26 輸入：資料日與利率方向的指示（#113 G1、G5、G3）', () => {
  const framing = buildMarketCloseFraming('2026-11-24', '2026-11-26')
  const userContent = formatUserContent({
    brief: BRIEF,
    analystOutputs: [],
    news: [],
    citations: [],
    briefDate: '2026-11-26',
    marketCloseFraming: framing,
    marketSnapshot: SNAPSHOT_2026_11_26,
  }, false)

  it('user content 標出 11/25 收盤缺資料，11/24 不得當最新行情或放進標題（G1）', () => {
    expect(userContent).toContain('前一交易日（11/25）的台股收盤缺資料')
    expect(userContent).toContain('11/24 的加權指數不是最新行情')
    expect(userContent).toContain('不得放進標題')
  })

  it('system prompt 帶資料日一致與利率方向規則（G5、G3）', () => {
    expect(NARRATIVE_WRITER_SYSTEM_PROMPT).toContain('不得用「同期」「同日」「同時」「當天」')
    expect(NARRATIVE_WRITER_SYSTEM_PROMPT).toContain('美債 2 年期殖利率高於 Fed funds 利率')
    expect(NARRATIVE_WRITER_SYSTEM_PROMPT).toContain('不得沿用降息框架')
  })

  it('user content 逐字快照', () => {
    expect(userContent).toMatchSnapshot()
  })
})
