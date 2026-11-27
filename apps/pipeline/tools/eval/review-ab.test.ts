import type { BriefRunInputs } from '../../src/orchestrator/daily.js'
import { describe, expect, it } from 'vitest'
import { buildMarketCloseFraming } from '../../src/agents/market-close-framing.js'
import { EMPTY_MARKET_CONTEXT } from '../../src/ingest/market-data/context.js'
import { reviewMaterialFromStored } from './review-ab.js'
import { makeBrief } from './test-brief.js'

const NEWS = [
  { id: 1, title: '選上的新聞', url: 'https://e.com/1', text: 't1', publishedAt: '2026-11-26T14:00:00Z' },
  { id: 2, title: 'decomposer 刷掉的新聞', url: 'https://e.com/2', text: 't2', publishedAt: null },
]

const RUN_INPUTS: BriefRunInputs = {
  version: 1,
  editor: {
    news: NEWS,
    selection: { mainThemes: ['利率路徑'], dailyThesis: '利率上行壓抑成長股評價' } as never,
    storylineBlock: null,
    continuityHint: null,
  },
  market: { ...EMPTY_MARKET_CONTEXT, snapshotBlock: 'snap', calendarBlock: 'cal', officialBlock: 'off', taiexCloseDate: '2026-11-26' },
}

describe('reviewMaterialFromStored', () => {
  const brief = makeBrief({
    newsTitlesById: { 1: '選上的新聞' },
    claimLedger: [{ id: 'c1', kind: 'fact', claimType: 'named-number', claim: 'x', evidenceRefs: [], asOf: '2026-11-26', checks: [] }],
  })

  // 要與 pipeline 當天給 narrative-writer 的素材一致，比較才只差審稿這一步。
  it('還原當天 narrative-writer 拿到的素材', () => {
    expect(reviewMaterialFromStored('2026-11-27', brief, RUN_INPUTS)).toEqual({
      briefDate: '2026-11-27',
      brief,
      news: [{ id: '1', title: '選上的新聞', url: 'https://e.com/1', text: 't1', publishedAt: '2026-11-26T14:00:00Z' }],
      claimLedger: brief.claimLedger,
      mainThemes: ['利率路徑'],
      marketCloseFraming: buildMarketCloseFraming('2026-11-26', '2026-11-27'),
      marketSnapshot: 'snap',
      calendarBlock: 'cal',
      officialBlock: 'off',
    })
  })

  it('brief 沒有 newsTitlesById 時用全部選稿；沒有 editor 選題時不帶主軸', () => {
    const material = reviewMaterialFromStored('2026-11-27', makeBrief(), { ...RUN_INPUTS, editor: { ...RUN_INPUTS.editor, selection: null } })
    expect(material.news.map(n => n.id)).toEqual(['1', '2'])
    expect(material).not.toHaveProperty('mainThemes')
    expect(material.claimLedger).toEqual([])
  })
})
