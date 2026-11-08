import type { DailyProgress, RunStage, StageName } from './daily.js'
import type { GenerateBriefParams } from './run-brief.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { callAnalystTier1 } from '../agents/analyst.js'
import { DailyCostLimitExceededError } from '../agents/cost-gate.js'
import { callDecomposer } from '../agents/decomposer.js'
import { retrieveForDecomposed } from '../agents/retrieve-for-decomposed.js'
import { callSynthesizer } from '../agents/synthesizer.js'
import { EMPTY_MARKET_CONTEXT } from '../ingest/market-data/context.js'
import { generateBrief } from './run-brief.js'

vi.mock('../agents/analyst.js')
vi.mock('../agents/decomposer.js')
vi.mock('../agents/synthesizer.js')
vi.mock('../agents/retrieve-for-decomposed.js')
vi.mock('../agents/tier2-fanout.js', () => ({ stampTier1: (c: unknown) => c, runTier2Fanout: async () => [] }))

const NEWS = [1, 2, 3].map(id => ({ id, title: `t${id}`, url: `https://e.com/${id}`, text: 'x', publishedAt: null }))

function params(): { p: GenerateBriefParams, stages: StageName[] } {
  const stages: StageName[] = []
  const stage: RunStage = (name, run) => {
    stages.push(name)
    return run()
  }
  const progress: DailyProgress = { completedStages: [] }
  return {
    stages,
    p: {
      date: '2026-11-09',
      news: NEWS,
      market: EMPTY_MARKET_CONTEXT,
      editor: { news: NEWS, selection: null, storyline: null, storylineBlock: null, continuityHint: null },
      stage,
      progress,
    },
  }
}

const decomposed = { primaryEntity: { name: 'a', kind: 'b' }, topicTags: [], cascadeHypotheses: [] }
const analyst = { primaryImpact: 'p', cascadeChains: [], reasoning: 'r', claims: [] }

describe('generateBrief', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(callDecomposer).mockResolvedValue(decomposed)
    vi.mocked(retrieveForDecomposed).mockResolvedValue([])
    vi.mocked(callAnalystTier1).mockResolvedValue(analyst)
  })

  it('單則 decomposer 失敗只少該則，後續只分析存活的新聞', async () => {
    vi.mocked(callDecomposer).mockRejectedValueOnce(new Error('bad'))
    vi.mocked(callSynthesizer).mockRejectedValue(new Error('stop-here'))
    await expect(generateBrief(params().p)).rejects.toThrow('stop-here')
    expect(callAnalystTier1).toHaveBeenCalledTimes(2)
  })

  it('存活新聞不足 2 則時中止', async () => {
    vi.mocked(callDecomposer).mockRejectedValue(new Error('bad'))
    await expect(generateBrief(params().p)).rejects.toThrow('存活新聞不足')
  })

  it('analyst 扇出的花費閘例外不被當成單則失敗', async () => {
    vi.mocked(callAnalystTier1).mockRejectedValue(new DailyCostLimitExceededError(1, 2))
    const { p, stages } = params()
    await expect(generateBrief(p)).rejects.toBeInstanceOf(DailyCostLimitExceededError)
    expect(stages).toEqual(['decompose', 'retrieve', 'analyst'])
  })

  it('synthesize 觸發花費閘時 analyst 產出已進 progress', async () => {
    vi.mocked(callSynthesizer).mockRejectedValue(new DailyCostLimitExceededError(1, 2))
    const { p } = params()
    await expect(generateBrief(p)).rejects.toBeInstanceOf(DailyCostLimitExceededError)
    expect(p.progress.analystOutputs).toHaveLength(3)
    expect(p.progress.analystOutputs?.map(a => a.newsId)).toEqual(['1', '2', '3'])
  })
})
