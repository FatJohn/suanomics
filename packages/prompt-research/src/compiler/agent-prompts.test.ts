import type { MergedDraft } from '../types.js'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { MergedDraftSchema } from '../types.js'
import { buildAnalystPrompt } from './analyst-prompt.js'
import { buildDecomposerPrompt } from './decomposer-prompt.js'
import { buildSharedPreamble } from './shared-preamble.js'
import { buildSynthesizerPrompt } from './synthesizer-prompt.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// 路徑 B（2026-06-12）：curation YAML 閘下架後、frames 全量直通、不再分流到特定 agent。
// 此 fixture 模擬 draft 帶 frame、驗證 frame 仍能注入。
function draftWithFrames(): MergedDraft {
  return {
    generatedAt: '2026-06-12T00:00:00.000Z',
    sources: [],
    rawSourceRefs: [],
    frames: [
      {
        groupKey: 'liquidity-first',
        items: [
          {
            id: 'f1',
            sourceSlug: 'finance-live',
            frame: {
              id: 'f1',
              name: 'Frame 1：流動性優先',
              description: '先看流動性再看基本面',
              whenToApply: '央行政策轉向期',
              questions: ['M2 年增率趨勢？', '美債殖利率曲線形態？'],
            },
          },
        ],
      },
    ],
    vocabulary: [],
    redFlags: [],
  } as unknown as MergedDraft
}

const draft = MergedDraftSchema.parse(JSON.parse(
  readFileSync(resolve(__dirname, '__fixtures__/sample-merged-draft.json'), 'utf-8'),
))
const sharedPreamble = buildSharedPreamble(draft)

describe('buildDecomposerPrompt', () => {
  it('should include shared preamble at top', () => {
    const out = buildDecomposerPrompt({ draft, sharedPreamble })
    expect(out.startsWith(sharedPreamble) || out.startsWith('你是 Cascade')).toBe(true)
  })
  it('should include role section with cascadeHypotheses schema', () => {
    const out = buildDecomposerPrompt({ draft, sharedPreamble })
    expect(out).toContain('Decomposer')
    expect(out).toContain('cascadeHypotheses')
    expect(out).toContain('DecomposerOutputSchema')
  })
  it('should inject ALL draft frames with [from: <slug>] (no curation routing)', () => {
    // 路徑 B：閘下架後、所有 frame 直通、不再依 agent 分流
    const out = buildDecomposerPrompt({ draft, sharedPreamble })
    expect(out).toMatch(/\[from: .+\]/)
    expect(out).toContain('5-phase scoping workflow')
    expect(out).toContain('ratio-check')
  })
  it('should inject all draft frames without curation files', () => {
    const out = buildDecomposerPrompt({ draft: draftWithFrames(), sharedPreamble: '' })
    expect(out).toContain('## 分析框架')
    expect(out).toContain('[from: finance-live] Frame 1：流動性優先')
  })
  it('should NOT contain L3 compliance text', () => {
    const out = buildDecomposerPrompt({ draft, sharedPreamble })
    expect(out).not.toContain('44 條投信投顧禁用詞')
  })
  it('snapshot', () => {
    const out = buildDecomposerPrompt({ draft, sharedPreamble })
    expect(out).toMatchSnapshot()
  })
})

describe('buildAnalystPrompt', () => {
  it('should include role + AnalystOutputSchema reference + sector-only direction', () => {
    const out = buildAnalystPrompt({ draft, sharedPreamble })
    expect(out).toContain('Analyst')
    expect(out).toContain('AnalystOutputSchema')
    expect(out).toContain('sector')
  })
  it('should inject ALL draft frames (no curation routing)', () => {
    // 路徑 B：閘下架後、所有 frame 直通、analyst 也拿到原本只給 decomposer 的 frame
    const out = buildAnalystPrompt({ draft, sharedPreamble })
    expect(out).toContain('ratio-check')
    expect(out).toContain('5-phase scoping workflow')
  })
  it('should inject all draft frames without curation files', () => {
    const out = buildAnalystPrompt({ draft: draftWithFrames(), sharedPreamble: '' })
    expect(out).toContain('## 分析框架')
    expect(out).toContain('M2 年增率趨勢？')
  })
  it('should NOT contain L3 compliance text', () => {
    const out = buildAnalystPrompt({ draft, sharedPreamble })
    expect(out).not.toContain('44 條投信投顧禁用詞')
  })
  it('snapshot', () => {
    const out = buildAnalystPrompt({ draft, sharedPreamble })
    expect(out).toMatchSnapshot()
  })
})

describe('buildSynthesizerPrompt', () => {
  it('should include L3 compliance bottom line (abstract phrasing only, no echo of forbidden literals)', () => {
    const out = buildSynthesizerPrompt({ draft, sharedPreamble })
    expect(out).toContain('合規鐵線')
    expect(out).toContain('44 條')
  })

  it('should NOT include any FORBIDDEN_PHRASES literal in synthesizer prompt', async () => {
    // Regression guard for reviewer C1: 跟 shared-preamble 同樣防 forbidden-phrase echo。
    // synthesizer prompt 之前 hard-code 看多/看空/偏多/...這些字、daily-brief 路徑沒走過 evaluation、
    // 但靜態檢查能保證未來不會回頭加上。
    const { FORBIDDEN_PHRASES } = await import('@suanomics/shared')
    const out = buildSynthesizerPrompt({ draft, sharedPreamble })
    for (const phrase of FORBIDDEN_PHRASES) {
      expect(out, `synthesizer prompt should not contain FORBIDDEN_PHRASE: "${phrase}"`).not.toContain(phrase)
    }
  })
  it('should include redFlags section', () => {
    const out = buildSynthesizerPrompt({ draft, sharedPreamble })
    expect(out).toMatch(/red\s*flag|紅線/i)
  })
  it('should reference MarketBriefSchema as output', () => {
    const out = buildSynthesizerPrompt({ draft, sharedPreamble })
    expect(out).toContain('MarketBriefSchema')
  })
  it('should include synthesizer-assigned frames', () => {
    const out = buildSynthesizerPrompt({ draft, sharedPreamble })
    expect(out).toContain('ratio-check') // analyst+synthesizer
  })
  it('synthesizer should inject draft frames and red flags without curation files', () => {
    const draftWithRedFlags = {
      ...draftWithFrames(),
      redFlags: [{ id: 'r1', sourceSlug: 'finance-live', entry: { id: 'r1', rule: '不得出現個股買賣建議' } }],
    } as unknown as MergedDraft
    const out = buildSynthesizerPrompt({ draft: draftWithRedFlags, sharedPreamble: '' })
    expect(out).toContain('## Red Flags')
    expect(out).toContain('[from: finance-live] 不得出現個股買賣建議')
    expect(out).toContain('## Synthesizer 框架')
  })
  it('should include self-check checklist', () => {
    const out = buildSynthesizerPrompt({ draft, sharedPreamble })
    expect(out).toMatch(/合規最後檢查|自己再 review|自我檢查/)
  })
  it('snapshot', () => {
    const out = buildSynthesizerPrompt({ draft, sharedPreamble })
    expect(out).toMatchSnapshot()
  })
})
