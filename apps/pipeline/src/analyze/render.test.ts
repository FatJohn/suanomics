import type { AnalystOutput } from '../agents/types.js'
import { describe, expect, it } from 'vitest'
import { COMPLIANCE_STRIPPED_PLACEHOLDER } from '../brief/analyzer.js'
import { findComplianceViolations, renderAnalysisMarkdown, sanitizeAnalysis, titleFromText } from './render.js'

function analysis(overrides: Partial<AnalystOutput> = {}): AnalystOutput {
  return {
    primaryImpact: '降息使資金成本下降',
    reasoning: '利率下行有利高估值族群',
    claims: [],
    cascadeChains: [
      {
        chainId: 't1-0',
        tier: 1,
        industry: '半導體',
        mechanism: '資金回流成長股',
        affectedTickers: ['2330 台積電'],
        direction: 'positive',
        citations: [{ url: 'https://example.com/fed', title: 'Fed 聲明', quote: '下調 25 基點' }],
      },
      {
        chainId: 't2-0',
        tier: 2,
        parentChainId: 't1-0',
        industry: '設備',
        mechanism: '擴產帶動設備需求',
        affectedTickers: [],
        direction: 'neutral',
        citations: [],
        speculative: true,
      },
    ],
    ...overrides,
  }
}

describe('renderAnalysisMarkdown', () => {
  const base = { title: '聯準會降息', date: '2026-11-17', costUsd: 0.12345, calls: 3 }

  it('印出標題、來源、報告日、主要影響與推理', () => {
    const md = renderAnalysisMarkdown({ ...base, url: 'https://example.com/a', analysis: analysis() })
    expect(md).toContain('# 單篇分析：聯準會降息')
    expect(md).toContain('- 來源：https://example.com/a')
    expect(md).toContain('- 報告日：2026-11-17')
    expect(md).toContain('## 主要影響\n\n降息使資金成本下降')
    expect(md).toContain('## 推理\n\n利率下行有利高估值族群')
  })

  it('沒有 url 時標示來源是貼上的文字', () => {
    expect(renderAnalysisMarkdown({ ...base, analysis: analysis() })).toContain('- 來源：貼上的文字')
  })

  it('每條連動鏈印方向、機制、標的與引用，二階標出承接的一階與推測', () => {
    const md = renderAnalysisMarkdown({ ...base, analysis: analysis() })
    expect(md).toContain('### t1-0 半導體（正向）\n\n資金回流成長股')
    expect(md).toContain('- 相關標的：2330 台積電')
    expect(md).toContain('- 來源：[Fed 聲明](https://example.com/fed)：「下調 25 基點」')
    expect(md).toContain('### t2-0 設備（中性，承接 t1-0，推測）\n\n擴產帶動設備需求')
    expect(md).toContain('- 來源：無')
  })

  it('沒有連動鏈時明說', () => {
    expect(renderAnalysisMarkdown({ ...base, analysis: analysis({ cascadeChains: [] }) })).toContain('## 連動鏈\n\n（沒有產出連動鏈）')
  })

  it('最後一行是單次花費與呼叫數', () => {
    const md = renderAnalysisMarkdown({ ...base, analysis: analysis() })
    expect(md.trimEnd().split('\n').at(-1)).toBe('單次花費：US$0.1235（3 次 LLM 呼叫）')
  })
})

describe('sanitizeAnalysis', () => {
  it('改寫禁用語並刪掉違規句，必填欄位清空時補中性文字', () => {
    const out = sanitizeAnalysis(analysis({
      primaryImpact: '建議買進台積電',
      reasoning: '利率下行。建議買進台積電。',
    }))
    expect(out.primaryImpact).toBe(COMPLIANCE_STRIPPED_PLACEHOLDER)
    expect(out.reasoning).toBe('利率下行。')
  })

  it('連動鏈的機制、標的與引用都要清，空掉的標的移除', () => {
    const chain = analysis().cascadeChains[0]
    if (chain === undefined)
      throw new Error('fixture')
    const out = sanitizeAnalysis(analysis({
      cascadeChains: [{ ...chain, mechanism: '外資賣超，散戶加碼台積電。資金回流。', affectedTickers: ['加碼 2330', '2454 聯發科'], citations: [{ url: 'https://example.com/x', title: '建議買進', quote: '看多 2330' }] }],
    }))
    const sanitized = out.cascadeChains[0]
    expect(sanitized?.mechanism).toBe('資金回流。')
    expect(sanitized?.affectedTickers).toEqual(['2454 聯發科'])
    expect(sanitized?.citations[0]).toEqual({ url: 'https://example.com/x', title: COMPLIANCE_STRIPPED_PLACEHOLDER, quote: '動能延續 2330' })
  })

  it('乾淨的內容原樣保留', () => {
    expect(sanitizeAnalysis(analysis())).toEqual(analysis())
  })
})

describe('findComplianceViolations', () => {
  it('逐行檢查，回報違規的行', () => {
    expect(findComplianceViolations('第一行\n建議買進\n台積電\n看多')).toEqual(['建議買進', '看多'])
  })

  it('乾淨的輸出回空陣列', () => {
    expect(findComplianceViolations(renderAnalysisMarkdown({ title: 't', date: '2026-11-17', costUsd: 0, calls: 0, analysis: analysis() }))).toEqual([])
  })
})

describe('titleFromText', () => {
  it('取第一個非空行', () => {
    expect(titleFromText('\n\n  聯準會降息  \n內文')).toBe('聯準會降息')
  })

  it('超過 80 字時截斷', () => {
    expect(titleFromText('字'.repeat(100))).toBe(`${'字'.repeat(79)}…`)
  })
})
