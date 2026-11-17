import type { QualityJudgeOutput } from './quality-judge.js'
import { describe, expect, it } from 'vitest'
import { QualityJudgeResponse, runQualityJudge, scoreQuality } from './quality-judge.js'
import { QUALITY_JUDGE_SYSTEM_PROMPT } from './quality-judge.prompt.js'
import { makeBrief } from './test-brief.js'

const section = (heading: string, body: string) => ({ heading, body, takeaway: null, relatedNewsIds: [], claimIds: [], citationUrls: ['https://example.com/fed'] })
const brief = makeBrief({
  narrative: {
    intro: '今日主軸是利率，值得持續觀察。',
    sections: [
      section('利率壓過 AI', '殖利率升至 5.1%，折現率上升使台積電等成長股評價承壓，值得持續觀察。'),
      section('台股資金', '三大法人賣超 1,144 億元，值得持續觀察。'),
    ],
    outro: '若殖利率回落到 5% 以下，這條壓力線才會鬆動。',
  },
})
const pass = (evidence: string) => ({ evidence, verdict: 'pass' as const })
const fail = (evidence: string) => ({ evidence, verdict: 'fail' as const })

function output(overrides: Partial<QualityJudgeOutput> = {}): QualityJudgeOutput {
  return {
    sections: [
      { heading: '利率壓過 AI', chain: pass('折現率上升使台積電等成長股評價承壓'), mechanism: pass('折現率上升使台積電等成長股評價承壓') },
      { heading: '台股資金', chain: fail('只有法人賣超金額，沒有觸發事件與產業'), mechanism: fail('沒有傳導管道') },
    ],
    unsupported: [],
    boilerplate: [],
    falsifier: pass('若殖利率回落到 5% 以下，這條壓力線才會鬆動'),
    ...overrides,
  }
}

describe('scoreQuality', () => {
  it('逐段統計 chain 與 mechanism 的通過數', () => {
    const score = scoreQuality(output(), brief)
    expect(score).toMatchObject({ sections: 2, chainPass: 1, mechanismPass: 1, unverifiedPasses: 0, missingSections: [], falsifier: 'pass' })
  })

  it('pass 的證據不是報告原文就不算通過，另計 unverifiedPasses', () => {
    const o = output({ sections: [
      { heading: '利率壓過 AI', chain: pass('殖利率推升台積電的融資成本'), mechanism: pass('折現率上升使台積電等成長股評價承壓') },
      { heading: '台股資金', chain: fail('x'), mechanism: fail('x') },
    ] })
    expect(scoreQuality(o, brief)).toMatchObject({ chainPass: 0, mechanismPass: 1, unverifiedPasses: 1 })
  })

  it('judge 漏掉的段落列進 missingSections，報告沒有的小標忽略', () => {
    const o = output({ sections: [
      { heading: '利率壓過 AI', chain: pass('折現率上升使台積電等成長股評價承壓'), mechanism: pass('折現率上升使台積電等成長股評價承壓') },
      { heading: '不存在的段落', chain: pass('x'), mechanism: pass('x') },
    ] })
    expect(scoreQuality(o, brief)).toMatchObject({ chainPass: 1, missingSections: ['台股資金'] })
  })

  it('無依據的數字與事件只算報告裡真的有的引文，重複的只算一次', () => {
    const o = output({ unsupported: [
      { quote: '三大法人賣超 1,144 億元', kind: 'number', note: '底本沒有' },
      { quote: '三大法人賣超1,144億元', kind: 'number', note: '重複' },
      { quote: '殖利率升至 5.1%', kind: 'number', note: '底本沒有' },
      { quote: 'Fed 宣布升息', kind: 'event', note: '報告沒有這句' },
    ] })
    expect(scoreQuality(o, brief)).toMatchObject({ unsupportedNumbers: 2, unsupportedEvents: 0, unmatchedQuotes: 1 })
  })

  it('套話以機械計數為準：出現在 3 個以上區塊才留下', () => {
    // 「殖利率升至 5.1%」剛好出現在 2 個區塊（摘要、段落1），卡在門檻下緣。
    const o = output({ boilerplate: [{ phrase: '值得持續觀察' }, { phrase: '殖利率升至 5.1%' }, { phrase: '折現率上升' }] })
    expect(scoreQuality(o, brief).boilerplate).toEqual([{ phrase: '值得持續觀察', blocks: 3 }])
  })

  it('反證條件的證據對不上原文時記為 pass-unverified', () => {
    expect(scoreQuality(output({ falsifier: pass('若 CPI 下滑則論點失效') }), brief).falsifier).toBe('pass-unverified')
    expect(scoreQuality(output({ falsifier: fail('沒有') }), brief).falsifier).toBe('fail')
  })

  it('沒有 narrative 的報告段落數是 0', () => {
    expect(scoreQuality(output({ sections: [] }), makeBrief())).toMatchObject({ sections: 0, chainPass: 0, missingSections: [] })
  })
})

describe('runQualityJudge', () => {
  it('用 brief-quality-judge 與固定 system prompt 呼叫一次，回傳原始輸出與分數', async () => {
    const calls: { name: string, systemPrompt: string, userContent: string }[] = []
    const result = await runQualityJudge(
      { date: '2026-11-17', brief, facts: { marketSnapshot: '美債10年期 5.1%', calendar: null, official: null, news: [] } },
      async (name, input, schema) => {
        calls.push({ name, ...input })
        return schema.parse(output())
      },
    )
    expect(calls).toHaveLength(1)
    expect(calls[0]?.name).toBe('brief-quality-judge')
    expect(calls[0]?.systemPrompt).toBe(QUALITY_JUDGE_SYSTEM_PROMPT)
    expect(calls[0]?.userContent).toContain('[段落1「利率壓過 AI」]')
    expect(result.score.chainPass).toBe(1)
    expect(QualityJudgeResponse.safeParse(result.output).success).toBe(true)
  })
})
