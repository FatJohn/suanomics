import type { EvidenceClaim } from '@suanomics/shared'
import { describe, expect, it } from 'vitest'
import { buildDebateMaterial } from './viewpoints-debate.prompt.js'

describe('buildDebateMaterial', () => {
  const base = {
    thesis: '今日主線由 AI 算力與利率拉鋸主導',
    headline: '台股權值續強',
    summary: '外資回補、半導體領漲',
    marketSnapshot: '加權指數 23000（+1.2%）',
    cascadeChains: [
      { industry: '半導體', mechanism: 'CoWoS 滿載', affectedTickers: ['2330'], direction: 'positive' as const, citations: [] },
    ],
  }
  it('includes thesis, headline, summary', () => {
    const out = buildDebateMaterial(base)
    expect(out).toContain('今日主線由 AI 算力與利率拉鋸主導')
    expect(out).toContain('台股權值續強')
    expect(out).toContain('外資回補、半導體領漲')
  })
  it('includes market snapshot when present', () => {
    expect(buildDebateMaterial(base)).toContain('加權指數 23000')
  })
  it('omits market data block when snapshot null', () => {
    expect(buildDebateMaterial({ ...base, marketSnapshot: null })).not.toContain('# 市場數據')
  })
  it('renders cascade chain lines', () => {
    expect(buildDebateMaterial(base)).toContain('半導體｜CoWoS 滿載｜positive')
  })
  it('caps cascade chains at 20', () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ industry: `ind${i}`, mechanism: 'm', affectedTickers: [], direction: 'neutral' as const, citations: [] }))
    const out = buildDebateMaterial({ ...base, cascadeChains: many })
    expect(out).toContain('ind0｜')
    expect(out).toContain('ind19｜')
    expect(out).not.toContain('ind20｜')
  })

  // 辯論 agent 原本看不到 claimLedger，於是反向數字（08-12 的費半 12,098、
  // 三大法人買超 280 億）躺在 ledger 裡沒進 riskPoints。
  describe('claim ledger', () => {
    const sox: EvidenceClaim = {
      id: 'c18',
      kind: 'fact',
      claimType: 'named-number',
      claim: '2026年8月11日費城半導體指數收於12,098點。',
      evidenceRefs: [{ kind: 'series', seriesId: 'us-sox', asOf: '2026-08-11' }],
      asOf: '2026-08-11',
      checks: ['D1'],
    }
    const netBuy: EvidenceClaim = {
      id: 'c12',
      kind: 'fact',
      claimType: 'named-number',
      claim: '昨日台股三大法人買超金額為280億元。',
      evidenceRefs: [{ kind: 'citation', url: 'https://example.com/a' }],
      asOf: '2026-08-11',
      checks: [],
    }
    const claims: EvidenceClaim[] = [sox, netBuy]

    it('renders ledger claims with id and text', () => {
      const out = buildDebateMaterial({ ...base, claimLedger: claims })
      expect(out).toContain('[c18]')
      expect(out).toContain('費城半導體指數收於12,098點')
      expect(out).toContain('[c12]')
      expect(out).toContain('買超金額為280億元')
    })

    it('renders every claim, uncapped — 反向事實可能落在任何一條，截斷會把它丟掉', () => {
      const many: EvidenceClaim[] = Array.from({ length: 45 }, (_, i) => ({
        ...sox,
        id: `c${i}`,
        claim: `第${i}條。`,
      }))
      const out = buildDebateMaterial({ ...base, claimLedger: many })
      expect(out).toContain('[c0]')
      expect(out).toContain('[c44]')
    })

    it('omits the ledger section entirely when no claims', () => {
      expect(buildDebateMaterial({ ...base, claimLedger: [] })).not.toContain('# 本日已核對的證據')
      expect(buildDebateMaterial(base)).not.toContain('# 本日已核對的證據')
    })
  })
})
