import type { DailyDeps, DailyLogEvent } from './daily.js'
import { isTwseTradingDay } from '@suanomics/shared'
import { describe, expect, it, vi } from 'vitest'
import { DailyCostGate, DailyCostLimitExceededError, LlmAccountError } from '../agents/cost-gate.js'
import { runDaily } from './daily.js'

const DATE = '2026-11-09'
const brief = { headline: 'H', summary: 'S' }

function fakeDeps(overrides: Partial<DailyDeps> = {}): DailyDeps & { events: DailyLogEvent[] } {
  const events: DailyLogEvent[] = []
  return {
    events,
    gate: new DailyCostGate(1),
    log: e => events.push(e),
    isTradingDay: () => true,
    findExistingBrief: vi.fn(async () => null),
    refreshNews: vi.fn(async () => 3),
    today: () => DATE,
    hasCompleteBriefOnOrAfter: vi.fn(async () => false),
    ingest: vi.fn(async () => []),
    loadMarket: vi.fn(async () => ({}) as never),
    selectNews: vi.fn(async () => ({
      news: [{ id: 1, title: 't', url: 'u', text: 'x', publishedAt: null }],
      selection: null,
      storyline: { storylineTouches: [], resolveStorylines: [], newStorylines: [{ title: 'a', thesis: 'b', entities: [] }] },
      storylineBlock: null,
      continuityHint: null,
    })),
    generateBrief: vi.fn(async () => brief as never),
    saveBrief: vi.fn(async () => 7),
    saveIncompleteBrief: vi.fn(async () => undefined),
    applyStorylines: vi.fn(async () => undefined),
    ...overrides,
  }
}

const over = () => new DailyCostLimitExceededError(1, 1.2)

describe('runDaily', () => {
  // 只保留最新幾則的 feed 撐不到下一個交易日，休市期間的新聞要當天抓進候選池。
  it('非交易日只抓新聞、不產報告，回 skipped', async () => {
    const deps = fakeDeps({ isTradingDay: () => false })
    expect(await runDaily({ date: DATE, force: false }, deps)).toEqual({ status: 'skipped', reason: 'non-trading-day', date: DATE })
    expect(deps.refreshNews).toHaveBeenCalledTimes(1)
    expect(deps.findExistingBrief).not.toHaveBeenCalled()
    expect(deps.ingest).not.toHaveBeenCalled()
    expect(deps.saveBrief).not.toHaveBeenCalled()
    expect(deps.events).toContainEqual({ event: 'non_trading_refresh', date: DATE, inserted: 3, calls: 0, usd: 0 })
  })

  it('非交易日抓新聞的 LLM 花費記在該日期名下：先設報告日再抓', async () => {
    const order: string[] = []
    const deps = fakeDeps({ isTradingDay: () => false, refreshNews: vi.fn(async () => {
      order.push('refresh')
      return 0
    }) })
    vi.spyOn(deps.gate, 'setReportDate').mockImplementation((d) => {
      order.push(`setReportDate:${d}`)
    })
    await runDaily({ date: DATE, force: false }, deps)
    expect(order).toEqual([`setReportDate:${DATE}`, 'refresh'])
  })

  it('補跑過去的非交易日不抓新聞：抓到的是今天的 feed，花費會記錯日期', async () => {
    const deps = fakeDeps({ isTradingDay: () => false, today: () => '2026-11-11' })
    expect(await runDaily({ date: DATE, force: true }, deps)).toEqual({ status: 'skipped', reason: 'non-trading-day', date: DATE })
    expect(deps.refreshNews).not.toHaveBeenCalled()
  })

  it('非交易日抓新聞失敗時 run 失敗，不吞錯', async () => {
    const deps = fakeDeps({ isTradingDay: () => false, refreshNews: vi.fn(async () => Promise.reject(new LlmAccountError('billing'))) })
    await expect(runDaily({ date: DATE, force: false }, deps)).rejects.toBeInstanceOf(LlmAccountError)
  })

  it('交易日不另外抓新聞：ingest 已經包含這一步', async () => {
    const deps = fakeDeps()
    await runDaily({ date: DATE, force: false }, deps)
    expect(deps.refreshNews).not.toHaveBeenCalled()
  })

  it('當日已有 brief 且未帶 force 時不跑', async () => {
    const deps = fakeDeps({ findExistingBrief: vi.fn(async () => ({ status: 'complete' })) })
    expect(await runDaily({ date: DATE, force: false }, deps)).toEqual({ status: 'skipped', reason: 'already-exists', date: DATE })
    expect(deps.ingest).not.toHaveBeenCalled()
  })

  it('已有 incomplete brief 且未帶 force 也不跑，避免備援排程把當日花費翻倍', async () => {
    const deps = fakeDeps({ findExistingBrief: vi.fn(async () => ({ status: 'incomplete' })) })
    expect((await runDaily({ date: DATE, force: false }, deps)).status).toBe('skipped')
    expect(deps.ingest).not.toHaveBeenCalled()
  })

  it('帶 force 時略過已存在檢查並重跑', async () => {
    const deps = fakeDeps({ findExistingBrief: vi.fn(async () => ({ status: 'complete' })) })
    expect((await runDaily({ date: DATE, force: true }, deps)).status).toBe('complete')
    expect(deps.saveBrief).toHaveBeenCalled()
  })

  it('完整路徑：先寫 brief 再寫 storylines', async () => {
    const order: string[] = []
    const deps = fakeDeps({
      saveBrief: vi.fn(async () => {
        order.push('save')
        return 7
      }),
      applyStorylines: vi.fn(async () => {
        order.push('storylines')
      }),
    })
    expect(await runDaily({ date: DATE, force: false }, deps)).toMatchObject({ status: 'complete', briefId: 7 })
    expect(order).toEqual(['save', 'storylines'])
    expect(deps.saveBrief).toHaveBeenCalledWith(DATE, [1], 'H\n\nS', brief)
  })

  it('首次產出當日報告時照常新建 storyline', async () => {
    const deps = fakeDeps()
    await runDaily({ date: DATE, force: false }, deps)
    expect(vi.mocked(deps.applyStorylines).mock.calls[0]?.[1].newStorylines).toHaveLength(1)
    expect(deps.events.some(e => e.event === 'storylines_new_skipped')).toBe(false)
  })

  it('重跑或補跑（當日或之後已有完整報告）不新建 storyline，其餘寫回照做', async () => {
    const storyline = {
      storylineTouches: [{ storylineId: 1, valence: 'support' as const, note: 'n' }],
      resolveStorylines: [{ storylineId: 2, disposition: 'confirmed' as const, note: 'n' }],
      newStorylines: [{ title: 'a', thesis: 'b', entities: [] }],
    }
    const deps = fakeDeps({
      hasCompleteBriefOnOrAfter: vi.fn(async () => true),
      selectNews: vi.fn(async () => ({ news: [{ id: 1, title: 't', url: 'u', text: 'x', publishedAt: null }], selection: null, storyline, storylineBlock: null, continuityHint: null })),
    })
    await runDaily({ date: DATE, force: true }, deps)
    expect(deps.hasCompleteBriefOnOrAfter).toHaveBeenCalledWith(DATE)
    expect(deps.applyStorylines).toHaveBeenCalledWith(DATE, { ...storyline, newStorylines: [] })
    expect(deps.events).toContainEqual({ event: 'storylines_new_skipped', date: DATE, count: 1 })
  })

  it('要在寫入 brief 之前判定重跑，否則每次都會看到自己剛寫的那份', async () => {
    const order: string[] = []
    const deps = fakeDeps({
      hasCompleteBriefOnOrAfter: vi.fn(async () => {
        order.push('check')
        return false
      }),
      saveBrief: vi.fn(async () => {
        order.push('save')
        return 7
      }),
    })
    await runDaily({ date: DATE, force: false }, deps)
    expect(order).toEqual(['check', 'save'])
  })

  it('storylines 寫回失敗不影響 brief，但要留下 log', async () => {
    const deps = fakeDeps({ applyStorylines: vi.fn(async () => {
      throw new Error('db down')
    }) })
    expect((await runDaily({ date: DATE, force: false }, deps)).status).toBe('complete')
    expect(deps.events.some(e => e.event === 'storylines_failed')).toBe(true)
  })

  it('花費閘在 agents 階段觸發：保留已完成階段、標 incomplete、不寫 storylines', async () => {
    const deps = fakeDeps({
      generateBrief: vi.fn(async (p) => {
        await p.stage('decompose', async () => undefined)
        p.progress.analystOutputs = [{ newsId: '1' }] as never
        return p.stage('analyst', async () => {
          throw over()
        })
      }),
    })
    const result = await runDaily({ date: DATE, force: false }, deps)
    expect(result).toMatchObject({ status: 'incomplete', failedStage: 'analyst' })
    expect(deps.saveBrief).not.toHaveBeenCalled()
    expect(deps.applyStorylines).not.toHaveBeenCalled()
    expect(deps.saveIncompleteBrief).toHaveBeenCalledWith(DATE, [1], expect.objectContaining({
      failedStage: 'analyst',
      completedStages: ['ingest', 'market-context', 'editor', 'decompose'],
      analystOutputs: [{ newsId: '1' }],
    }))
  })

  it('花費閘在 ingest 觸發：仍寫一筆 incomplete，選稿為空', async () => {
    const deps = fakeDeps({ ingest: vi.fn(async () => {
      throw over()
    }) })
    expect(await runDaily({ date: DATE, force: false }, deps)).toMatchObject({ status: 'incomplete', failedStage: 'ingest' })
    expect(deps.saveIncompleteBrief).toHaveBeenCalledWith(DATE, [], expect.objectContaining({ completedStages: [] }))
  })

  it('花費閘以外的錯誤往外丟，不寫 incomplete', async () => {
    const deps = fakeDeps({ generateBrief: vi.fn(async () => {
      throw new Error('boom')
    }) })
    await expect(runDaily({ date: DATE, force: false }, deps)).rejects.toThrow('boom')
    expect(deps.saveIncompleteBrief).not.toHaveBeenCalled()
  })

  it('帳務錯誤讓 run 失敗，不寫 incomplete 也不寫 brief', async () => {
    const deps = fakeDeps({ selectNews: vi.fn(async () => {
      throw new LlmAccountError('billing')
    }) })
    await expect(runDaily({ date: DATE, force: false }, deps)).rejects.toBeInstanceOf(LlmAccountError)
    expect(deps.saveIncompleteBrief).not.toHaveBeenCalled()
    expect(deps.saveBrief).not.toHaveBeenCalled()
  })

  it('補跑舊日期時帳本的 report_date 是 --date，不是今天', async () => {
    const gate = new DailyCostGate(1)
    const spy = vi.spyOn(gate, 'setReportDate')
    await runDaily({ date: DATE, force: false }, fakeDeps({ gate }))
    expect(spy).toHaveBeenCalledWith(DATE)
  })

  it('每階段記開始與結束，含耗時、呼叫數與 USD 差額', async () => {
    const gate = new DailyCostGate(1)
    const deps = fakeDeps({
      gate,
      ingest: vi.fn(async () => {
        gate.record(0.25)
        gate.record(0.25)
        return []
      }),
    })
    await runDaily({ date: DATE, force: false }, deps)
    expect(deps.events.find(e => e.event === 'stage_start' && e.stage === 'ingest')).toBeDefined()
    expect(deps.events.find(e => e.event === 'stage_end' && e.stage === 'ingest')).toMatchObject({ calls: 2, usd: 0.5 })
    expect(deps.events.find(e => e.event === 'stage_end' && e.stage === 'editor')).toMatchObject({ calls: 0, usd: 0 })
  })
})

// 交易日只看 TWSE：用正式的 isTwseTradingDay，不是 fake。
describe('runDaily 依 TWSE 開休市決定是否產出', () => {
  it.each([
    ['2026-09-12', '週六'],
    ['2026-09-13', '週日'],
    ['2026-10-09', 'TWSE 休市日（國慶補假）'],
    ['2026-12-25', '台美都休市（行憲紀念日／Christmas）'],
  ])('%s（%s）回 skipped: non-trading-day', async (date) => {
    const deps = fakeDeps({ isTradingDay: isTwseTradingDay })
    expect(await runDaily({ date, force: false }, deps)).toEqual({ status: 'skipped', reason: 'non-trading-day', date })
    expect(deps.ingest).not.toHaveBeenCalled()
  })

  it('美股休市但台股開盤（2026-11-26 感恩節）照常產出', async () => {
    const deps = fakeDeps({ isTradingDay: isTwseTradingDay })
    expect(await runDaily({ date: '2026-11-26', force: false }, deps)).toEqual({ status: 'complete', date: '2026-11-26', briefId: 7 })
  })
})
