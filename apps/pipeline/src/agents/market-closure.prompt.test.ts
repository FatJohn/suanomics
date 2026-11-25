import type { CallNarrativeWriterParams } from './narrative-writer.js'
import { describe, expect, it } from 'vitest'
import { formatUserContent as formatEditorContent } from './editor.js'
import { buildMarketClosureBlock } from './market-closure.js'
import { formatUserContent as formatNarrativeContent } from './narrative-writer.js'

// 休市後第一個交易日的統整指示要同時進 editor（選稿）與 narrative-writer（主文）：
// 只進 editor 時選得到週末新聞，主文仍會用「昨夜」把整段休市期間講成一晚。
const CLOSURE = buildMarketClosureBlock('2026-09-14') ?? ''

const editorBase = {
  candidates: [{ id: 1, title: 't', excerpt: 'e', category: 'macro' as const }],
  storylines: [],
  recentBriefs: [],
}

function narrativeBase(briefDate: string): CallNarrativeWriterParams {
  return {
    brief: {
      headline: 'h',
      summary: 's',
      relatedNews: [],
      affectedIndustries: [],
      relatedETFs: [],
      reasoningChain: ['r'],
      citations: [],
      disclaimer: '本分析僅供參考、非投資建議、實際投資請諮詢專業人士',
    },
    analystOutputs: [],
    news: [],
    citations: [],
    briefDate,
  }
}

describe('統整休市期間的指示進 prompt', () => {
  it('前提：休市後第一個交易日真的有指示可放', () => {
    expect(CLOSURE).toContain('休市後第一個交易日')
  })

  it('editor：有 closureBlock 時放進 user content，沒有時不出現', () => {
    expect(formatEditorContent({ ...editorBase, closureBlock: CLOSURE })).toContain(CLOSURE)
    expect(formatEditorContent(editorBase)).not.toContain('休市後第一個交易日')
    expect(formatEditorContent({ ...editorBase, closureBlock: null })).not.toContain('休市後第一個交易日')
  })

  it('narrative-writer：有 closureBlock 時放進 user content，沒有時不出現', () => {
    expect(formatNarrativeContent({ ...narrativeBase('2026-09-14'), closureBlock: CLOSURE }, false)).toContain(CLOSURE)
    expect(formatNarrativeContent(narrativeBase('2026-09-15'), false)).not.toContain('休市後第一個交易日')
  })
})
