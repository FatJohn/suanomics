import type { Narrative } from '@suanomics/shared'
import type { NarrativeReviewMaterial, ReviewNote } from '../agents/narrative-review.js'
import { containsForbiddenPhrase, FORBIDDEN_PHRASES } from '@suanomics/shared'
import { describe, expect, it } from 'vitest'
import { makeBrief } from '../../tools/eval/test-brief.js'
import { NARRATIVE_REVIEWER_SYSTEM_PROMPT, NARRATIVE_REVISER_SYSTEM_PROMPT } from './narrative-review.prompt.js'
import { formatReviewerUserContent, formatReviewMaterial, formatReviserUserContent } from './narrative-review.user-content.js'
import { FORBIDDEN_PHRASES_LINE } from './source-authority.js'

const DRAFT: Narrative = {
  intro: '美債殖利率升破 5%，壓抑科技估值。',
  sections: [{
    heading: '利率',
    takeaway: '折現率上行',
    body: '10 年期殖利率升至 5.1%，晶圓代工評價承壓。',
    relatedNewsIds: ['n1'],
    claimIds: ['c1'],
    citationUrls: ['https://example.com/fed'],
  }],
  outro: '後續看 Fed 會議紀要。',
}

const MATERIAL: NarrativeReviewMaterial = {
  briefDate: '2026-11-27',
  brief: makeBrief({
    dailyThesis: '利率上行壓抑成長股評價',
    cascadeChains: [{ industry: '晶圓代工', mechanism: '折現率上行壓抑評價', affectedTickers: ['2330'], direction: 'negative', citations: [] }],
  }),
  news: [{ id: 'n1', title: 'Fed 官員示警通膨', url: 'https://example.com/fed', text: '官員表示通膨走錯方向', publishedAt: '2026-11-26T14:00:00Z' }],
  claimLedger: [{ id: 'c1', kind: 'fact', claimType: 'named-number', claim: '10 年期殖利率 5.1%', evidenceRefs: [], asOf: '2026-11-26', checks: [] }],
  mainThemes: ['利率路徑'],
  marketCloseFraming: '## 收盤框架\n加權指數資料日 2026-11-26',
  marketSnapshot: '美債 10Y 5.1%（2026-11-26）',
  calendarBlock: null,
  officialBlock: '央行理監事會 12/18',
}

const NOTES: ReviewNote[] = [{ kind: 'unsupported', quote: '晶圓代工評價承壓', note: '底本沒有評價數字，刪除或改寫' }]

describe.each([
  ['reviewer', NARRATIVE_REVIEWER_SYSTEM_PROMPT],
  ['reviser', NARRATIVE_REVISER_SYSTEM_PROMPT],
])('%s system prompt 的合規', (_name, prompt) => {
  it('帶入 shared 的 compliance 禁用語清單', () => {
    for (const phrase of FORBIDDEN_PHRASES)
      expect(prompt).toContain(phrase)
  })

  it('只在 shared 清單那一行出現禁用語', () => {
    expect(prompt).toContain(FORBIDDEN_PHRASES_LINE)
    expect(containsForbiddenPhrase(prompt.replaceAll(FORBIDDEN_PHRASES_LINE, ''))).toEqual({ hit: false })
  })
})

describe('reviewer system prompt', () => {
  it('只列三類問題', () => {
    for (const kind of ['unsupported', 'mixed-date', 'off-thesis'])
      expect(NARRATIVE_REVIEWER_SYSTEM_PROMPT).toContain(kind)
  })

  // chain fail 多半是素材本身沒有具名落點，要求補上等於鼓勵捏造（#125 評估）。
  it('不要求補充底本以外的內容', () => {
    expect(NARRATIVE_REVIEWER_SYSTEM_PROMPT).toContain('不得要求補上底本以外')
  })

  it('要求 quote 逐字抄草稿', () => {
    expect(NARRATIVE_REVIEWER_SYSTEM_PROMPT).toContain('逐字複製')
  })
})

describe('reviser system prompt', () => {
  it('只改被點名的句子，其餘逐字保留', () => {
    expect(NARRATIVE_REVISER_SYSTEM_PROMPT).toContain('只改審稿意見')
    expect(NARRATIVE_REVISER_SYSTEM_PROMPT).toContain('逐字保留')
  })

  it('不新增底本以外的事實', () => {
    expect(NARRATIVE_REVISER_SYSTEM_PROMPT).toContain('不新增事實底本以外')
  })
})

describe('formatReviewMaterial', () => {
  const text = formatReviewMaterial(MATERIAL)

  it.each([
    ['報告日', '2026-11-27'],
    ['標題', MATERIAL.brief.headline],
    ['摘要', MATERIAL.brief.summary],
    ['本日論點', '利率上行壓抑成長股評價'],
    ['主軸', '- 利率路徑'],
    ['收盤框架', '加權指數資料日 2026-11-26'],
    ['市場數據', '美債 10Y 5.1%（2026-11-26）'],
    ['新聞標題', 'Fed 官員示警通膨'],
    ['新聞摘錄', '官員表示通膨走錯方向'],
    ['連動鏈', '晶圓代工 → 2330'],
    ['引用來源', 'https://example.com/fed'],
    ['claim ledger', '[c1]'],
    ['官方公告', '央行理監事會 12/18'],
  ])('含%s', (_label, expected) => {
    expect(text).toContain(expected)
  })

  it('沒有的素材不留空標題', () => {
    expect(text).not.toContain('行事曆')
  })
})

describe('formatReviewerUserContent', () => {
  const text = formatReviewerUserContent(MATERIAL, DRAFT)

  it('含事實底本與逐區塊標好的草稿', () => {
    expect(text).toContain(formatReviewMaterial(MATERIAL))
    expect(text).toContain(`[開場] ${DRAFT.intro}`)
    expect(text).toContain('[段落1「利率」]')
    expect(text).toContain('10 年期殖利率升至 5.1%，晶圓代工評價承壓。')
    expect(text).toContain('重點：折現率上行')
    expect(text).toContain(`[收尾] ${DRAFT.outro}`)
  })
})

describe('formatReviserUserContent', () => {
  const text = formatReviserUserContent(MATERIAL, DRAFT, NOTES)

  it('含底本、審稿意見與可逐字複製的草稿 JSON', () => {
    expect(text).toContain(formatReviewMaterial(MATERIAL))
    expect(text).toContain('unsupported')
    expect(text).toContain('晶圓代工評價承壓')
    expect(text).toContain('底本沒有評價數字，刪除或改寫')
    expect(text).toContain(JSON.stringify(DRAFT, null, 2))
  })
})
