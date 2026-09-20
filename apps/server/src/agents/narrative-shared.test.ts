import type { RetryReason } from './narrative-shared.js'
import { describe, expect, it } from 'vitest'
import {
  classifyError,
  COMPLIANCE_REWRITE_MAP,
  rewriteText,
  stripControlChars,
} from './narrative-shared.js'

describe('classifyError', () => {
  it('classifies AbortError as timeout', () => {
    const e = new Error('aborted')
    e.name = 'AbortError'
    expect(classifyError(e)).toBe('timeout')
  })
  it('classifies messages containing "timeout" as timeout', () => {
    expect(classifyError(new Error('Request timeout exceeded'))).toBe('timeout')
  })
  it('classifies ZodError as zod-parse', () => {
    const e = new Error('zod failed')
    e.name = 'ZodError'
    expect(classifyError(e)).toBe('zod-parse')
  })
  it('classifies "Required" message as zod-parse', () => {
    expect(classifyError(new Error('Required'))).toBe('zod-parse')
  })
  it('classifies "unknown citation url" as zod-parse', () => {
    expect(classifyError(new Error('unknown citation url'))).toBe('zod-parse')
  })
  it('falls back to gemini-api for unrecognized errors', () => {
    expect(classifyError(new Error('500 Internal Server Error'))).toBe('gemini-api')
  })
})

describe('rewriteText', () => {
  it('rewrites known forbidden terms and increments counter', () => {
    const counter = { count: 0 }
    const out = rewriteText('看多 進場時機', counter)
    expect(out).toBe('動能延續 建立部位時點')
    expect(counter.count).toBe(2)
  })
  it('leaves clean text unchanged', () => {
    const counter = { count: 0 }
    expect(rewriteText('純粹的市場觀察', counter)).toBe('純粹的市場觀察')
    expect(counter.count).toBe(0)
  })
  it('counts each distinct forbidden hit (multiple occurrences of same term count as 1)', () => {
    const counter = { count: 0 }
    rewriteText('看多 看多 看多', counter)
    expect(counter.count).toBe(1)
  })
})

describe('rewriteText soft-recommendation phrases', () => {
  it('rewrites 軟推薦 phrases away', () => {
    expect(rewriteText('本益比修正壓力值得關注。', { count: 0 })).not.toContain('值得關注')
    expect(rewriteText('建議觀察後續', { count: 0 })).not.toContain('建議觀察')
    expect(rewriteText('可以考慮配置', { count: 0 })).not.toContain('可以考慮')
    expect(rewriteText('值得留意風險', { count: 0 })).not.toContain('值得留意')
    expect(rewriteText('中華電法說會也值得追蹤', { count: 0 })).not.toContain('值得追蹤')
  })
  it('rewrites 避開 away', () => {
    expect(rewriteText('成功避開關稅風險', { count: 0 })).not.toContain('避開')
  })
  it('rewrites 少碰 to 減少接觸', () => {
    const out = rewriteText('少碰科技股', { count: 0 })
    expect(out).not.toContain('少碰')
    expect(out).toContain('減少接觸')
  })
  it('rewrites 繞開 to 規避', () => {
    const out = rewriteText('繞開能源板塊', { count: 0 })
    expect(out).not.toContain('繞開')
    expect(out).toContain('規避')
  })
})

describe('nARRATIVE_REWRITE_MAP', () => {
  it('contains the core trading verbs', () => {
    const keys = COMPLIANCE_REWRITE_MAP.map(([k]) => k)
    expect(keys).toContain('看多')
    expect(keys).toContain('看空')
    expect(keys).toContain('進場時機')
    expect(keys).toContain('出場時機')
  })
  it('all replacements are non-empty strings', () => {
    for (const [, v] of COMPLIANCE_REWRITE_MAP) {
      expect(typeof v).toBe('string')
      expect(v.length).toBeGreaterThan(0)
    }
  })
})

describe('retryReason type', () => {
  it('accepts all 4 union variants', () => {
    const _values: RetryReason[] = ['zod-parse', 'gemini-api', 'timeout', 'compliance-residual', null]
    expect(_values).toHaveLength(5)
  })
})

describe('stripControlChars', () => {
  it('removes the U+001A SUB control char that caused the 6-16 mojibake', () => {
    expect(stripControlChars('壓力\u001A還是在那裡')).toBe('壓力還是在那裡')
  })
  it('keeps newline and tab', () => {
    expect(stripControlChars('a\nb\tc')).toBe('a\nb\tc')
  })
  it('removes other C0/C1/DEL controls', () => {
    expect(stripControlChars('a\u0007b\u0000c\u007Fd\u0085e')).toBe('abcde')
  })
  it('removes zero-width, BiDi noise and BOM', () => {
    expect(stripControlChars('a\u200Bb\u200Ec\uFEFFd\u2060e')).toBe('abcde')
  })
  it('removes the Unicode replacement char', () => {
    expect(stripControlChars('a\uFFFDb')).toBe('ab')
  })
  it('removes lone surrogates but keeps valid surrogate pairs (emoji)', () => {
    expect(stripControlChars('a\uD800b')).toBe('ab') // lone high
    expect(stripControlChars('a\uDC00b')).toBe('ab') // lone low
    expect(stripControlChars('a\u{1F525}b')).toBe('a\u{1F525}b') // valid pair preserved
  })
  it('does not touch CJK, full-width punctuation, or normal ASCII', () => {
    expect(stripControlChars('台積電，2330 漲 3%。')).toBe('台積電，2330 漲 3%。')
  })
})
