import type { MergedDraft } from '../types.js'

import { describe, expect, it } from 'vitest'
import { buildDecomposerPrompt } from './decomposer-prompt.js'

describe('decomposer prompt · cross-domain mandate', () => {
  it('should contain cross-domain hypothesis mandate text', () => {
    const out = buildDecomposerPrompt({
      draft: { generatedAt: '2026-04-27T00:00:00.000Z', sources: [], frames: [] } as unknown as MergedDraft,
      sharedPreamble: '',
    })
    expect(out).toContain('跨域')
    expect(out.toLowerCase()).toContain('至少')
    expect(out).toMatch(/(geopolitical|policy|regulatory)/i)
  })

  it('should mention common cross-domain alias groups', () => {
    const out = buildDecomposerPrompt({
      draft: { generatedAt: '2026-04-27T00:00:00.000Z', sources: [], frames: [] } as unknown as MergedDraft,
      sharedPreamble: '',
    })
    expect(out).toMatch(/兩岸|台海/)
    expect(out).toMatch(/CHIPS|友岸/)
  })

  it('should still mention hard cap 6 hypotheses', () => {
    const out = buildDecomposerPrompt({
      draft: { generatedAt: '2026-04-27T00:00:00.000Z', sources: [], frames: [] } as unknown as MergedDraft,
      sharedPreamble: '',
    })
    // hard cap 既有 prompt 已寫 0-6 範圍、新 instruction 不該破壞
    expect(out).toMatch(/上限.*6|0–6/)
  })

  it('should mention regulatory framework benchmarking dimension', () => {
    const out = buildDecomposerPrompt({
      draft: { generatedAt: '2026-04-27T00:00:00.000Z', sources: [], frames: [] } as unknown as MergedDraft,
      sharedPreamble: '',
    })
    expect(out).toMatch(/監管框架|SEC.*MAS|MiCA/)
  })
})
