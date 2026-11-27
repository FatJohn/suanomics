import type { Narrative } from '@suanomics/shared'
import type { NarrativeReviewMaterial } from './narrative-review.js'
import type { CallNarrativeWriterResult } from './narrative-writer.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeBrief } from '../../tools/eval/test-brief.js'
import { NARRATIVE_REVIEWER_SYSTEM_PROMPT, NARRATIVE_REVISER_SYSTEM_PROMPT } from '../prompts/narrative-review.prompt.js'
import { callAgent } from './call-agent.js'
import { DailyCostLimitExceededError } from './cost-gate.js'
import { narrativeReviewEnabled, reviewAndRevise, reviewMaterialFromParams, reviewNarrative } from './narrative-review.js'
import { NarrativeReviewResponse } from './response-schemas.js'

vi.mock('./call-agent.js', async () => {
  const actual = await vi.importActual<typeof import('./call-agent.js')>('./call-agent.js')
  return { ...actual, callAgent: vi.fn() }
})

const URL_A = 'https://example.com/fed'
const BAD_SENTENCE = '台積電目標價上看 2000 元。'

const DRAFT: Narrative = {
  intro: `美債殖利率升破 5%，壓抑科技估值，今天的主線是利率。${'a'.repeat(120)}`,
  sections: [{
    heading: '利率',
    takeaway: '折現率上行',
    body: `10 年期殖利率升至 5.1%。${BAD_SENTENCE}${'b'.repeat(260)}`,
    relatedNewsIds: ['n1'],
    claimIds: [],
    citationUrls: [URL_A],
  }],
  outro: `後續看 Fed 會議紀要。${'c'.repeat(120)}`,
}

const REVISED_RAW = {
  intro: DRAFT.intro,
  sections: [{ heading: '利率', takeaway: '折現率上行', body: `10 年期殖利率升至 5.1%。${'b'.repeat(260)}`, relatedNewsIds: ['n1'], claimIds: [], citationUrls: [URL_A] }],
  outro: DRAFT.outro,
}

const MATERIAL: NarrativeReviewMaterial = {
  briefDate: '2026-11-27',
  brief: makeBrief({ citations: [{ title: 'Fed', url: URL_A, quote: 'q' }] }),
  news: [{ id: 'n1', title: 'Fed 官員示警通膨', url: URL_A, text: 'tx', publishedAt: null }],
  claimLedger: [],
}

const FIRST: CallNarrativeWriterResult = {
  narrative: DRAFT,
  audit: { failed: false, retryReason: null, fabricationStripped: 0, claimIdsStripped: 0, claimCitationUrlsDropped: 0, claimCitationSections: 0, claimUnboundNumbers: 0, claimCheckedNumbers: 0, claimIdsTruncated: 0 },
}

const NOTE = { kind: 'unsupported', quote: '台積電目標價上看 2000 元', note: '底本沒有目標價，刪除' } as const

function agentsCalled(): string[] {
  return vi.mocked(callAgent).mock.calls.map(c => c[0])
}

beforeEach(() => {
  vi.mocked(callAgent).mockReset()
  vi.stubEnv('NARRATIVE_REVIEW_ENABLED', 'true')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('narrativeReviewResponse', () => {
  it('接受 notes 陣列', () => {
    expect(NarrativeReviewResponse.parse({ notes: [NOTE] })).toEqual({ notes: [NOTE] })
  })

  it('kind 限三類', () => {
    expect(() => NarrativeReviewResponse.parse({ notes: [{ ...NOTE, kind: 'style' }] })).toThrow()
  })
})

describe('narrativeReviewEnabled', () => {
  it('預設關閉', () => {
    vi.stubEnv('NARRATIVE_REVIEW_ENABLED', '')
    expect(narrativeReviewEnabled()).toBe(false)
  })

  it('設為 true 才開', () => {
    expect(narrativeReviewEnabled()).toBe(true)
  })
})

describe('reviewNarrative', () => {
  it('用 narrative-reviewer 與審稿 system prompt 呼叫一次', async () => {
    vi.mocked(callAgent).mockResolvedValueOnce({ notes: [] })
    await reviewNarrative(MATERIAL, DRAFT)
    expect(agentsCalled()).toEqual(['narrative-reviewer'])
    expect(vi.mocked(callAgent).mock.calls[0]?.[1].systemPrompt).toBe(NARRATIVE_REVIEWER_SYSTEM_PROMPT)
  })

  it('沒有意見時 ok', async () => {
    vi.mocked(callAgent).mockResolvedValueOnce({ notes: [] })
    expect(await reviewNarrative(MATERIAL, DRAFT)).toEqual({ ok: true, notes: [] })
  })

  // 引文對不回草稿的意見無法定位要改哪一句，交給修訂者只會讓它自由發揮。
  it('丟掉 quote 對不回草稿的意見，全被丟掉時 ok', async () => {
    vi.mocked(callAgent).mockResolvedValueOnce({ notes: [{ ...NOTE, quote: '草稿裡沒有這一句話' }] })
    expect(await reviewNarrative(MATERIAL, DRAFT)).toEqual({ ok: true, notes: [] })
  })

  it('quote 比對忽略全半形與空白差異', async () => {
    vi.mocked(callAgent).mockResolvedValueOnce({ notes: [{ ...NOTE, quote: '台積電目標價上看 ２０００ 元' }] })
    expect((await reviewNarrative(MATERIAL, DRAFT))?.notes).toHaveLength(1)
  })

  it('過短的 quote 不算對得上', async () => {
    vi.mocked(callAgent).mockResolvedValueOnce({ notes: [{ ...NOTE, quote: '台積' }] })
    expect(await reviewNarrative(MATERIAL, DRAFT)).toEqual({ ok: true, notes: [] })
  })

  it('quote 超過 60 字不算可定位', async () => {
    vi.mocked(callAgent).mockResolvedValueOnce({ notes: [{ ...NOTE, quote: DRAFT.sections[0]?.body.slice(0, 70) ?? '' }] })
    expect(await reviewNarrative(MATERIAL, DRAFT)).toEqual({ ok: true, notes: [] })
  })

  it('點名小標或重點行的意見丟掉', async () => {
    vi.mocked(callAgent).mockResolvedValueOnce({ notes: [{ ...NOTE, quote: '折現率上行' }] })
    expect(await reviewNarrative(MATERIAL, DRAFT)).toEqual({ ok: true, notes: [] })
  })

  it('同一段引文只留一筆', async () => {
    vi.mocked(callAgent).mockResolvedValueOnce({ notes: [NOTE, { ...NOTE, note: '重複' }] })
    expect(await reviewNarrative(MATERIAL, DRAFT)).toEqual({ ok: false, notes: [NOTE] })
  })

  it('呼叫失敗回 null', async () => {
    vi.mocked(callAgent).mockRejectedValueOnce(new Error('500'))
    expect(await reviewNarrative(MATERIAL, DRAFT)).toBeNull()
  })

  it('花費閘錯誤往外丟', async () => {
    vi.mocked(callAgent).mockRejectedValueOnce(new DailyCostLimitExceededError(1, 2))
    await expect(reviewNarrative(MATERIAL, DRAFT)).rejects.toBeInstanceOf(DailyCostLimitExceededError)
  })
})

describe('reviewAndRevise', () => {
  it('旗標關閉時不呼叫、回原稿', async () => {
    vi.stubEnv('NARRATIVE_REVIEW_ENABLED', '')
    expect(await reviewAndRevise(MATERIAL, FIRST)).toBe(FIRST)
    expect(callAgent).not.toHaveBeenCalled()
  })

  it('narrative 已失敗時不審稿', async () => {
    const failed = { ...FIRST, narrative: null }
    expect(await reviewAndRevise(MATERIAL, failed)).toBe(failed)
    expect(callAgent).not.toHaveBeenCalled()
  })

  it('審稿通過時不修訂、回原稿', async () => {
    vi.mocked(callAgent).mockResolvedValueOnce({ notes: [] })
    expect(await reviewAndRevise(MATERIAL, FIRST)).toBe(FIRST)
    expect(agentsCalled()).toEqual(['narrative-reviewer'])
  })

  it('審稿失敗時回原稿', async () => {
    vi.mocked(callAgent).mockRejectedValueOnce(new Error('timeout'))
    expect(await reviewAndRevise(MATERIAL, FIRST)).toBe(FIRST)
  })

  it('有意見時用 narrative-reviser 修訂一次並回修訂稿', async () => {
    vi.mocked(callAgent).mockResolvedValueOnce({ notes: [NOTE] }).mockResolvedValueOnce(REVISED_RAW)
    const result = await reviewAndRevise(MATERIAL, FIRST)
    expect(agentsCalled()).toEqual(['narrative-reviewer', 'narrative-reviser'])
    expect(vi.mocked(callAgent).mock.calls[1]?.[1].systemPrompt).toBe(NARRATIVE_REVISER_SYSTEM_PROMPT)
    expect(vi.mocked(callAgent).mock.calls[1]?.[1].userContent).toContain(NOTE.note)
    expect(result.narrative?.sections[0]?.body).not.toContain(BAD_SENTENCE)
  })

  // 不迴圈：修訂失敗不重試、不再審，保留原稿（設計依據〈不做的事〉）。
  it('修訂產出不合 schema 時不重試、回原稿', async () => {
    vi.mocked(callAgent).mockResolvedValueOnce({ notes: [NOTE] }).mockResolvedValueOnce({ intro: 'x' })
    expect(await reviewAndRevise(MATERIAL, FIRST)).toBe(FIRST)
    expect(agentsCalled()).toEqual(['narrative-reviewer', 'narrative-reviser'])
  })

  it('修訂稿違反 compliance 時回原稿', async () => {
    // 一定會漲不在 sanitize 的替換表，會走到 compliance 硬擋。
    const violating = { ...REVISED_RAW, outro: `${DRAFT.outro}一定會漲。` }
    vi.mocked(callAgent).mockResolvedValueOnce({ notes: [NOTE] }).mockResolvedValueOnce(violating)
    expect(await reviewAndRevise(MATERIAL, FIRST)).toBe(FIRST)
  })

  // 修訂者只該改被點名的句子；段落數、小標或重點行變了就是越權改寫。
  it.each([
    ['少了段落', { ...REVISED_RAW, sections: [] }],
    ['小標被改', { ...REVISED_RAW, sections: [{ ...REVISED_RAW.sections[0], heading: '新小標' }] }],
    ['重點行被改', { ...REVISED_RAW, sections: [{ ...REVISED_RAW.sections[0], takeaway: '新重點' }] }],
  ])('修訂稿%s時回原稿', async (_label, revised) => {
    vi.mocked(callAgent).mockResolvedValueOnce({ notes: [NOTE] }).mockResolvedValueOnce(revised)
    expect(await reviewAndRevise(MATERIAL, FIRST)).toBe(FIRST)
  })

  it('修訂時撞到花費閘往外丟', async () => {
    vi.mocked(callAgent).mockResolvedValueOnce({ notes: [NOTE] }).mockRejectedValueOnce(new DailyCostLimitExceededError(1, 2))
    await expect(reviewAndRevise(MATERIAL, FIRST)).rejects.toBeInstanceOf(DailyCostLimitExceededError)
  })
})

describe('reviewMaterialFromParams', () => {
  it('取 narrative-writer 的同一份素材，缺的 block 不帶', () => {
    const brief = makeBrief({ dailyThesis: '利率上行壓抑成長股評價' })
    const material = reviewMaterialFromParams({
      brief,
      analystOutputs: [],
      news: MATERIAL.news,
      citations: brief.citations,
      briefDate: '2026-11-27',
      marketSnapshot: 'snap',
      officialBlock: null,
      mainThemes: ['利率路徑'],
      storylineBlock: 'story',
      closureBlock: null,
    })
    expect(material).toEqual({
      briefDate: '2026-11-27',
      brief,
      news: MATERIAL.news,
      claimLedger: [],
      mainThemes: ['利率路徑'],
      marketCloseFraming: null,
      marketSnapshot: 'snap',
      calendarBlock: null,
      officialBlock: null,
      storylineBlock: 'story',
      closureBlock: null,
      weeklyRecapBlock: null,
    })
  })
})
