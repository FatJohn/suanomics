import type { ContinuityJudgeOutput } from './continuity-judge.js'
import type { ContinuityJudgeInput } from './continuity-judge.prompt.js'
import { describe, expect, it } from 'vitest'
import { runContinuityJudge, scoreContinuity } from './continuity-judge.js'
import { CONTINUITY_JUDGE_SYSTEM_PROMPT } from './continuity-judge.prompt.js'
import { makeBrief } from './test-brief.js'

const today = makeBrief({ headline: '殖利率升至 5.1% 壓抑科技股', summary: '延續昨日的利率主線，殖利率再升至 5.1%。CPI 年增 3.72%。延續上週的關稅議題。' })
const yesterday = makeBrief({ headline: '殖利率逼近 5%', summary: '殖利率升至 4.98%。後續觀察週一公布的 CPI。另需留意 11/18 台指期結算。' })
const input: ContinuityJudgeInput = {
  date: '2026-11-17',
  brief: today,
  priors: [{ date: '2026-11-13', brief: yesterday }],
  storylines: [
    { id: 1, title: '利率取代地緣成為定價主軸', thesis: '殖利率上行壓抑估值', updates: [{ briefDate: '2026-11-13', valence: 'support', note: '殖利率 4.98%' }, { briefDate: '2026-11-17', valence: 'support', note: '殖利率 5.1%' }] },
    { id: 2, title: '中東衝突', thesis: '能源風險溢價', updates: [{ briefDate: '2026-11-17', valence: 'extend', note: '油價持平' }] },
    { id: 3, title: 'AI 電力', thesis: '電力瓶頸', updates: [{ briefDate: '2026-11-13', valence: 'extend', note: '電價' }] },
  ],
}

function output(overrides: Partial<ContinuityJudgeOutput> = {}): ContinuityJudgeOutput {
  return {
    storylines: [
      { id: 1, quote: '殖利率再升至 5.1%', verdict: 'delta', note: '新數字' },
      { id: 2, quote: '', verdict: 'absent', note: '沒提到' },
    ],
    carryOver: [
      { item: '後續觀察週一公布的 CPI', quote: 'CPI 年增 3.72%', verdict: 'addressed' },
      { item: '另需留意 11/18 台指期結算', quote: '', verdict: 'not_due' },
    ],
    falseContinuity: [{ quote: '延續上週的關稅議題', note: '前幾日報告沒有關稅' }],
    restatements: [],
    ...overrides,
  }
}

describe('scoreContinuity', () => {
  it('只統計今日有進展的敘事線，逐類計數', () => {
    expect(scoreContinuity(output(), input)).toMatchObject({
      touched: 2,
      delta: 1,
      restated: 0,
      absent: 1,
      missingStorylines: [],
      carryOverItems: 2,
      addressed: 1,
      notAddressed: 0,
      notDue: 1,
      falseContinuity: 1,
      restatements: 0,
      unverified: 0,
    })
  })

  it('judge 漏判的有進展敘事線列進 missingStorylines，今日沒進展的線忽略', () => {
    const o = output({ storylines: [{ id: 1, quote: '殖利率再升至 5.1%', verdict: 'delta', note: '' }, { id: 3, quote: '', verdict: 'absent', note: '' }] })
    expect(scoreContinuity(o, input)).toMatchObject({ touched: 2, delta: 1, absent: 0, missingStorylines: [2] })
  })

  it('delta 或 restated 的引文不在今日報告就不算，計入 unverified', () => {
    const o = output({ storylines: [{ id: 1, quote: '殖利率升至 5.3%', verdict: 'delta', note: '' }, { id: 2, quote: '', verdict: 'absent', note: '' }] })
    expect(scoreContinuity(o, input)).toMatchObject({ delta: 0, unverified: 1 })
  })

  it('待觀察項要逐字出自最近一份前日報告，addressed 的引文要在今日報告', () => {
    const o = output({ carryOver: [
      { item: '後續觀察週一公布的 CPI', quote: 'CPI 年增 3.80%', verdict: 'addressed' },
      { item: '昨日沒寫過這句', quote: '', verdict: 'not_addressed' },
    ] })
    expect(scoreContinuity(o, input)).toMatchObject({ carryOverItems: 1, addressed: 0, unverified: 2 })
  })

  it('假連續與重述句只算引文對得上的', () => {
    const o = output({
      falseContinuity: [{ quote: '延續上週的關稅議題', note: '' }, { quote: '報告沒有的句子', note: '' }],
      restatements: [
        { todayQuote: '殖利率升至 5.1% 壓抑科技股', priorQuote: '殖利率逼近 5%' },
        { todayQuote: '延續昨日的利率主線', priorQuote: '前日沒有的句子' },
      ],
    })
    expect(scoreContinuity(o, input)).toMatchObject({ falseContinuity: 1, restatements: 1, unverified: 2 })
  })
})

describe('scoreContinuity 防灌水', () => {
  it('極短引文不算對上原文', () => {
    const o = output({
      carryOver: [{ item: '週', quote: '美', verdict: 'addressed' }],
      falseContinuity: [{ quote: '，', note: '' }],
    })
    expect(scoreContinuity(o, input)).toMatchObject({ carryOverItems: 0, addressed: 0, falseContinuity: 0, unverified: 2 })
  })

  it('同一個待觀察項、假連續句、重述句重複列出只算一次', () => {
    const o = output({
      carryOver: Array.from({ length: 3 }, () => ({ item: '後續觀察週一公布的 CPI', quote: 'CPI 年增 3.72%', verdict: 'addressed' as const })),
      falseContinuity: Array.from({ length: 2 }, () => ({ quote: '延續上週的關稅議題', note: '' })),
      restatements: Array.from({ length: 2 }, () => ({ todayQuote: '殖利率升至 5.1% 壓抑科技股', priorQuote: '殖利率逼近 5%' })),
    })
    expect(scoreContinuity(o, input)).toMatchObject({ carryOverItems: 1, addressed: 1, falseContinuity: 1, restatements: 1, unverified: 0 })
  })

  it('重述句依 prompt 上限只取前 10 筆', () => {
    const todayLong = makeBrief({ summary: Array.from({ length: 12 }, (_, i) => `第${i}號論點延續不變`).join('。') })
    const priorLong = makeBrief({ summary: '殖利率逼近 5%，維持原判斷。' })
    const o = output({
      storylines: [],
      carryOver: [],
      falseContinuity: [],
      restatements: Array.from({ length: 12 }, (_, i) => ({ todayQuote: `第${i}號論點延續不變`, priorQuote: '殖利率逼近 5%' })),
    })
    const score = scoreContinuity(o, { ...input, brief: todayLong, priors: [{ date: '2026-11-13', brief: priorLong }] })
    expect(score.restatements).toBe(10)
  })
})

describe('runContinuityJudge', () => {
  it('用 brief-continuity-judge 與固定 system prompt 呼叫一次', async () => {
    const calls: { name: string, systemPrompt: string, userContent: string }[] = []
    const result = await runContinuityJudge(input, async (name, agentInput, schema) => {
      calls.push({ name, ...agentInput })
      return schema.parse(output())
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.name).toBe('brief-continuity-judge')
    expect(calls[0]?.systemPrompt).toBe(CONTINUITY_JUDGE_SYSTEM_PROMPT)
    expect(result.score.delta).toBe(1)
  })
})
