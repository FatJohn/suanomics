import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DailyCostLimitExceededError, LlmAccountError } from '../agents/cost-gate.js'
import { callEditor } from '../agents/editor.js'
import { getRecentBriefSummaries, selectNewsForBrief } from '../db/repos/news-repo.js'
import { getOpenStorylines } from '../db/repos/storylines-repo.js'
import { EMPTY_MARKET_CONTEXT } from '../ingest/market-data/context.js'
import { selectNewsViaEditor } from './editor-stage.js'

vi.mock('../agents/editor.js')
vi.mock('../db/repos/news-repo.js')
vi.mock('../db/repos/storylines-repo.js')

const selected = [{ id: 1, title: 't', url: 'u', contentText: 'x', category: 'macro' as const, publishedAt: null, fetchedAt: new Date(), sourceSlug: 's', topicTags: [] }]
const params = { date: '2026-11-09', selected, market: EMPTY_MARKET_CONTEXT }

describe('selectNewsViaEditor', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(getOpenStorylines).mockResolvedValue([])
    vi.mocked(getRecentBriefSummaries).mockResolvedValue([])
    vi.mocked(selectNewsForBrief).mockResolvedValue([{ id: 9, title: 'f', url: 'u', text: 'x', publishedAt: new Date('2026-11-08T12:00:00Z') }, { id: 10, title: 'g', url: 'v', text: 'y', publishedAt: null }])
  })

  it('花費閘例外往外丟，不退回 recency 繼續花錢', async () => {
    vi.mocked(callEditor).mockRejectedValue(new DailyCostLimitExceededError(1, 2))
    await expect(selectNewsViaEditor(params)).rejects.toBeInstanceOf(DailyCostLimitExceededError)
    expect(selectNewsForBrief).not.toHaveBeenCalled()
  })

  it('帳務錯誤往外丟，不退回 recency', async () => {
    vi.mocked(callEditor).mockRejectedValue(new LlmAccountError('db down'))
    await expect(selectNewsViaEditor(params)).rejects.toBeInstanceOf(LlmAccountError)
    expect(selectNewsForBrief).not.toHaveBeenCalled()
  })

  it('一般錯誤退回 recency', async () => {
    vi.mocked(callEditor).mockRejectedValue(new Error('bad'))
    expect((await selectNewsViaEditor(params)).news.map(n => n.id)).toEqual([9, 10])
  })

  it('退回 recency 時保留發布時間，narrative 才標得出相對日期', async () => {
    vi.mocked(callEditor).mockRejectedValue(new Error('bad'))
    expect((await selectNewsViaEditor(params)).news.map(n => n.publishedAt)).toEqual(['2026-11-08T12:00:00.000Z', null])
  })

  it('沒有候選時不打 editor', async () => {
    await selectNewsViaEditor({ ...params, selected: [] })
    expect(callEditor).not.toHaveBeenCalled()
  })
})
