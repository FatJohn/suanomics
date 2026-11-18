import { describe, expect, it } from 'vitest'
import {
  clampContentSummary,
  isMostlyChinese,
  SUMMARY_HARD_MAX,
  SUMMARY_MIN,
} from './entity-summary-normalize.js'

describe('clampContentSummary', () => {
  it('leaves in-spec summaries untouched', () => {
    const s = '一'.repeat(100)
    expect(clampContentSummary(s)).toBe(s)
  })

  it('leaves a summary exactly at the hard max untouched', () => {
    const s = '一'.repeat(SUMMARY_HARD_MAX)
    expect(clampContentSummary(s)).toBe(s)
  })

  // 2026-08-02 的 model A/B 實測到 flash-lite 會吐到 218 字（規格是 80–120）
  it('truncates the observed 218-char worst case down to the hard max', () => {
    const out = clampContentSummary('一'.repeat(218))
    expect(out.length).toBeLessThanOrEqual(SUMMARY_HARD_MAX)
  })

  it('cuts at a sentence boundary when there is one in range', () => {
    const s = `${'甲'.repeat(90)}。${'乙'.repeat(120)}`
    const out = clampContentSummary(s)
    expect(out.endsWith('。')).toBe(true)
    expect(out.length).toBe(91)
  })

  // 句界若落在 SUMMARY_MIN 之前，截到那裡會產生一句話的殘骸、比硬切更糟
  it('does not cut at a sentence boundary that would leave it under the min', () => {
    const s = `${'甲'.repeat(10)}。${'乙'.repeat(300)}`
    const out = clampContentSummary(s)
    expect(out.length).toBe(SUMMARY_HARD_MAX)
    expect(out.length).toBeGreaterThanOrEqual(SUMMARY_MIN)
  })

  // 英文摘要沒有全形句號，會走 fallback 硬切——不得 throw、長度仍要收斂
  it('falls back to a hard cut for English text with no CJK sentence enders', () => {
    const out = clampContentSummary('a'.repeat(300))
    expect(out.length).toBe(SUMMARY_HARD_MAX)
  })

  it('never returns something shorter than the input when the input is already short', () => {
    expect(clampContentSummary('短摘要')).toBe('短摘要')
  })
})

describe('isMostlyChinese', () => {
  it('accepts a normal Chinese summary', () => {
    expect(isMostlyChinese('台積電第二季營收年增二成，主要受惠先進製程需求。')).toBe(true)
  })

  // 實際觀察到的症狀：英文新聞整段吐英文摘要
  it('rejects an all-English summary', () => {
    expect(isMostlyChinese(
      'The Federal Reserve held rates steady, citing persistent inflation pressure.',
    )).toBe(false)
  })

  it('accepts Chinese prose carrying English proper nouns and numbers', () => {
    expect(isMostlyChinese('Fed 維持利率不變，聯邦基金利率區間續留 5.25%～5.50%，理由是通膨壓力仍在。')).toBe(true)
  })

  it('treats an empty string as not Chinese rather than throwing', () => {
    expect(isMostlyChinese('')).toBe(false)
  })

  it('ignores digits and punctuation when judging the ratio', () => {
    expect(isMostlyChinese('2026-08-03：油價下跌。')).toBe(true)
  })
})
