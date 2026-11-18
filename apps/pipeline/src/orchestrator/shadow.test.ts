import type { BriefRunInputs } from './daily.js'
import type { ShadowDeps } from './shadow.js'
import { describe, expect, it, vi } from 'vitest'
import { CostGateError, DailyCostGate } from '../agents/cost-gate.js'
import { runInputsHash } from '../db/repos/shadow-briefs-repo.js'
import { EMPTY_MARKET_CONTEXT } from '../ingest/market-data/context.js'
import { NO_CORPUS_VARIANT, runShadow, shadowCostLimit } from './shadow.js'

const DATE = '2026-11-19'
const NEWS = [1, 2].map(id => ({ id, title: `t${id}`, url: `u${id}`, text: 'x', publishedAt: null }))
const INPUTS: BriefRunInputs = {
  version: 1,
  editor: { news: NEWS, selection: null, storylineBlock: 'sb', continuityHint: 'ch' },
  market: { ...EMPTY_MARKET_CONTEXT, snapshotBlock: 'snap' },
}
const brief = { headline: 'H', summary: 'S' }

function fakeDeps(overrides: Partial<ShadowDeps> = {}): ShadowDeps {
  return {
    gate: new DailyCostGate(1),
    log: () => {},
    getSource: vi.fn(async () => ({ selectedNewsIds: [1, 2], runInputs: INPUTS as unknown })),
    getExisting: vi.fn(async () => null),
    generateBrief: vi.fn(async () => brief as never),
    saveShadow: vi.fn(async () => 9),
    ...overrides,
  }
}

describe('runShadow', () => {
  it('用正式報告的 run_inputs 關掉 corpus 重跑，存成 no-corpus 影子報告', async () => {
    const deps = fakeDeps()
    expect(await runShadow({ date: DATE, force: false }, deps)).toEqual({ status: 'complete', date: DATE, shadowId: 9 })
    const p = vi.mocked(deps.generateBrief).mock.calls[0]?.[0]
    expect(p).toMatchObject({ date: DATE, news: NEWS, market: INPUTS.market, retrieveCorpus: false })
    expect(p?.editor).toEqual({ ...INPUTS.editor, storyline: null })
    expect(deps.saveShadow).toHaveBeenCalledWith(DATE, NO_CORPUS_VARIANT, [1, 2], brief, runInputsHash(INPUTS))
  })

  it('帳本的報告日設成該報告日', async () => {
    const gate = new DailyCostGate(1)
    const setReportDate = vi.spyOn(gate, 'setReportDate')
    await runShadow({ date: DATE, force: false }, fakeDeps({ gate }))
    expect(setReportDate).toHaveBeenCalledWith(DATE)
  })

  it('已有同一份輸入產的影子報告時略過，不呼叫 LLM', async () => {
    const deps = fakeDeps({ getExisting: vi.fn(async () => ({ id: 3, inputsHash: runInputsHash(INPUTS) })) })
    expect(await runShadow({ date: DATE, force: false }, deps)).toEqual({ status: 'skipped', reason: 'already-exists', date: DATE })
    expect(deps.generateBrief).not.toHaveBeenCalled()
  })

  it('正式報告重跑換了輸入時，舊影子報告不算數、照常重跑', async () => {
    const deps = fakeDeps({ getExisting: vi.fn(async () => ({ id: 3, inputsHash: 'stale' })) })
    expect((await runShadow({ date: DATE, force: false }, deps)).status).toBe('complete')
  })

  it('--force 時已有影子報告也重跑', async () => {
    const deps = fakeDeps({ getExisting: vi.fn(async () => ({ id: 3, inputsHash: runInputsHash(INPUTS) })) })
    expect((await runShadow({ date: DATE, force: true }, deps)).status).toBe('complete')
  })

  it('沒有 complete 的正式報告時失敗，不呼叫 LLM', async () => {
    const deps = fakeDeps({ getSource: vi.fn(async () => null) })
    await expect(runShadow({ date: DATE, force: false }, deps)).rejects.toThrow('沒有 complete')
    expect(deps.generateBrief).not.toHaveBeenCalled()
  })

  it.each([
    ['null', null],
    ['版本不符', { ...INPUTS, version: 2 }],
    ['缺 editor.news', { ...INPUTS, editor: {} }],
    ['缺 market', { version: 1, editor: INPUTS.editor }],
  ])('run_inputs %s 時失敗，不呼叫 LLM', async (_label, runInputs) => {
    const deps = fakeDeps({ getSource: vi.fn(async () => ({ selectedNewsIds: [1], runInputs })) })
    await expect(runShadow({ date: DATE, force: false }, deps)).rejects.toThrow('run_inputs')
    expect(deps.generateBrief).not.toHaveBeenCalled()
  })

  it('generateBrief 失敗時不寫影子報告', async () => {
    const deps = fakeDeps({ generateBrief: vi.fn(async () => Promise.reject(new Error('boom'))) })
    await expect(runShadow({ date: DATE, force: false }, deps)).rejects.toThrow('boom')
    expect(deps.saveShadow).not.toHaveBeenCalled()
  })
})

describe('shadowCostLimit', () => {
  it('上限扣掉今天帳本已花的金額，影子報告與正式報告合計不超過每日上限', () => {
    expect(shadowCostLimit(3, 1.25)).toBeCloseTo(1.75)
    expect(shadowCostLimit(3, 0)).toBe(3)
  })

  it('今天已花到上限時在呼叫 LLM 前就失敗', () => {
    expect(() => shadowCostLimit(3, 3)).toThrow(CostGateError)
    expect(() => shadowCostLimit(3, 3.4)).toThrow(/已花/)
  })
})
