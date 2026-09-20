import type { MergedDraft } from '../types.js'
import { FORBIDDEN_PHRASES } from '@suanomics/shared'
import { describe, expect, it } from 'vitest'
import { buildSharedPreamble, GARNISH_DENYLIST } from './shared-preamble.js'

const emptyDraft: MergedDraft = {
  generatedAt: '2026-04-25T00:00:00Z',
  sources: [],
  frames: [],
  vocabulary: [],
  redFlags: [],
  rawSourceRefs: [],
}

describe('gARNISH_DENYLIST export', () => {
  it('is exported and contains the known abstract garnish terms', () => {
    expect(GARNISH_DENYLIST.has('資本配置效率')).toBe(true)
    expect(GARNISH_DENYLIST.has('營運效率指標趨於穩健')).toBe(true)
    expect(GARNISH_DENYLIST.size).toBeGreaterThanOrEqual(9)
  })
})

describe('buildSharedPreamble', () => {
  it('should include role context (Cascade pipeline 一員)', () => {
    const out = buildSharedPreamble(emptyDraft)
    expect(out).toMatch(/Cascade/i)
    expect(out).toMatch(/pipeline/i)
  })

  it('should NOT include L3 compliance (forbidden phrases / ticker direction)', () => {
    const out = buildSharedPreamble(emptyDraft)
    expect(out).not.toContain('44 條投信投顧禁用詞')
    expect(out).not.toMatch(/ticker.*方向/i)
  })

  it('精準術語（非 denylist）出現在「可用」清單、denylist 贅詞不在清單', () => {
    const draft: MergedDraft = {
      ...emptyDraft,
      vocabulary: [
        { id: 'v1', sourceSlug: 's1', entry: { id: 'v1', preferred: '評價趨勢評估', avoid: [], reason: 'r1' } },
        { id: 'v2', sourceSlug: 's2', entry: { id: 'v2', preferred: '利空鈍化', avoid: [], reason: 'r2' } },
      ],
    }
    const out = buildSharedPreamble(draft)
    const precisionLine = out.split('\n').find(l => l.includes('精準術語在真正貼切時可用')) ?? ''
    expect(precisionLine).toContain('利空鈍化')
    expect(precisionLine).not.toContain('評價趨勢評估')
  })

  it('反贅尾 bullet 點名抽象評價贅詞（全部 9 個 denylist 詞）', () => {
    const out = buildSharedPreamble(emptyDraft)
    expect(out).toContain('嚴禁固定贅尾')
    expect(out).not.toContain('## 用詞偏好')
    // 斷言全部 9 個 GARNISH_DENYLIST 詞都出現在 bullet
    const allDenylistTerms = [
      '評價趨勢評估',
      '配置調整建議',
      '營運展望樂觀',
      '資本配置效率',
      '回收期分析',
      '營運效率指標趨於穩健',
      '單位經濟模型優化',
      '經常性營收成長動能',
      '客戶流失率波動',
    ]
    for (const term of allDenylistTerms) {
      expect(out, `反贅尾 bullet 應包含 denylist 詞：「${term}」`).toContain(term)
    }
  })

  it('保留合規替換語意、但不 echo 禁用原詞', () => {
    const out = buildSharedPreamble(emptyDraft)
    expect(out).toContain('估值面承壓')
    expect(out).not.toContain('看空')
  })

  it('should not include any FORBIDDEN_PHRASES literal in preamble', () => {
    // Regression guard: 確保 shared preamble 不 echo 任何禁用字、避免失敗模式重現
    const draft: MergedDraft = {
      ...emptyDraft,
      vocabulary: [{
        id: 'v1',
        sourceSlug: 's1',
        entry: { id: 'v1', preferred: '配置比重提升', avoid: ['增持', '加碼'], reason: 'KOL 原話' },
      }],
    }
    const out = buildSharedPreamble(draft)
    for (const phrase of FORBIDDEN_PHRASES) {
      expect(out, `preamble should not contain FORBIDDEN_PHRASE: "${phrase}"`).not.toContain(phrase)
    }
  })

  it('should include vocab rows straight from draft even with no curation files', () => {
    const draft: MergedDraft = {
      ...emptyDraft,
      vocabulary: [
        { id: 'v1', sourceSlug: 'finance-live', entry: { id: 'v1', preferred: '動能延續', avoid: ['看多'], reason: '合規中性用語' } },
      ],
    }
    const out = buildSharedPreamble(draft)
    expect(out).toContain('## 用詞與可讀性')
    expect(out).toContain('動能延續')
  })

  it('should include L2 trust principles (citations / numbers)', () => {
    const out = buildSharedPreamble(emptyDraft)
    expect(out).toMatch(/citation/i)
    expect(out).toMatch(/不可自編|不可虛構/)
  })

  it('should include vocab from multiple sources', () => {
    const draft: MergedDraft = {
      ...emptyDraft,
      vocabulary: [
        { id: 'v1', sourceSlug: 's1', entry: { id: 'v1', preferred: 'A', avoid: [], reason: 'r1' } },
        { id: 'v2', sourceSlug: 's2', entry: { id: 'v2', preferred: 'B', avoid: [], reason: 'r2' } },
      ],
    }
    const out = buildSharedPreamble(draft)
    expect(out).toContain('A')
    expect(out).toContain('B')
  })
})
