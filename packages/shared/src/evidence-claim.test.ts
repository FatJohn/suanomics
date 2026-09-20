import { describe, expect, it } from 'vitest'
import {
  CONDITIONAL_MARKERS,
  EvidenceClaimSchema,
  EvidenceRefSchema,
  MARKER_EXCEPTIONS,
  SPECULATIVE_MARKERS,
} from './evidence-claim.js'

const CITATION_REF = { kind: 'citation', url: 'https://example.com/a' }
const SERIES_REF = { kind: 'series', seriesId: 'us-sox', asOf: '2026-08-04' }

const VALID_CLAIM = {
  id: 'c1',
  kind: 'fact',
  claimType: 'named-number',
  claim: '費城半導體指數 2026-08-04 收在 12,179.26 點。',
  evidenceRefs: [SERIES_REF],
  asOf: '2026-08-04',
  checks: ['D3', 'D4'],
}

describe('evidenceRefSchema', () => {
  it('accepts a citation ref', () => {
    expect(EvidenceRefSchema.safeParse(CITATION_REF).success).toBe(true)
  })
  it('accepts a series ref', () => {
    expect(EvidenceRefSchema.safeParse(SERIES_REF).success).toBe(true)
  })
  it('rejects an unknown ref kind', () => {
    expect(EvidenceRefSchema.safeParse({ kind: 'url', url: 'https://example.com' }).success).toBe(false)
  })
  // 兩種 ref 的 deterministic 檢查方式完全不同，欄位不可互換
  it('rejects a citation ref carrying series fields instead of a url', () => {
    expect(EvidenceRefSchema.safeParse({ kind: 'citation', seriesId: 'us-sox', asOf: '2026-08-04' }).success).toBe(false)
  })
  it('rejects a series ref without asOf', () => {
    expect(EvidenceRefSchema.safeParse({ kind: 'series', seriesId: 'us-sox' }).success).toBe(false)
  })
  it('rejects a citation ref whose url is not a url', () => {
    expect(EvidenceRefSchema.safeParse({ kind: 'citation', url: 'not-a-url' }).success).toBe(false)
  })
  it('rejects a series ref whose asOf is not YYYY-MM-DD', () => {
    expect(EvidenceRefSchema.safeParse({ kind: 'series', seriesId: 'us-sox', asOf: '2026/08/04' }).success).toBe(false)
  })
})

describe('evidenceClaimSchema', () => {
  it('accepts a valid claim', () => {
    expect(EvidenceClaimSchema.safeParse(VALID_CLAIM).success).toBe(true)
  })
  it('accepts an empty evidenceRefs array (D1 judges it, schema does not)', () => {
    expect(EvidenceClaimSchema.safeParse({ ...VALID_CLAIM, evidenceRefs: [] }).success).toBe(true)
  })
  it('defaults checks to an empty array', () => {
    const { checks: _c, ...rest } = VALID_CLAIM
    const r = EvidenceClaimSchema.parse(rest)
    expect(r.checks).toEqual([])
  })
  it('rejects an unknown kind or claimType', () => {
    expect(EvidenceClaimSchema.safeParse({ ...VALID_CLAIM, kind: 'guess' }).success).toBe(false)
    expect(EvidenceClaimSchema.safeParse({ ...VALID_CLAIM, claimType: 'vibes' }).success).toBe(false)
  })
  it('rejects an unknown check id', () => {
    expect(EvidenceClaimSchema.safeParse({ ...VALID_CLAIM, checks: ['D9'] }).success).toBe(false)
  })
  it('rejects an empty claim sentence and an empty id', () => {
    expect(EvidenceClaimSchema.safeParse({ ...VALID_CLAIM, claim: '' }).success).toBe(false)
    expect(EvidenceClaimSchema.safeParse({ ...VALID_CLAIM, id: '' }).success).toBe(false)
  })
  it('rejects asOf that is not YYYY-MM-DD', () => {
    expect(EvidenceClaimSchema.safeParse({ ...VALID_CLAIM, asOf: '2026-8-4' }).success).toBe(false)
  })
  // LLM 自報的 confidence 一律不採用、不得進 gate，故契約裡不該存在這個欄位
  it('strips a confidence field rather than carrying it through', () => {
    const r = EvidenceClaimSchema.parse({ ...VALID_CLAIM, confidence: 0.9 })
    expect(r).not.toHaveProperty('confidence')
  })
})

// 三個清單都是窮舉的、落在 code 的常數；新增詞要改常數並補測試。
describe('marker constants', () => {
  it('speculative markers match the expected list exactly', () => {
    expect([...SPECULATIVE_MARKERS]).toEqual(['可能', '預期', '恐', '若', '料將', '估計', '有望', '不排除', '研判'])
  })
  it('conditional markers match the expected list exactly', () => {
    expect([...CONDITIONAL_MARKERS]).toEqual(['若', '一旦', '假設', '倘', '前提是'])
  })
  // 後四個是 2026-08-05 驗收實測出來的誤判，允許新增：
  // 「新增詞要改常數並補測試」。誤判的後果不只是分類錯：fact 被降級後 D1 就不再要求
  // evidence，稽核力道會靜默被削弱。
  it('marker exceptions cover the expected list plus the false positives found in review', () => {
    expect([...MARKER_EXCEPTIONS]).toEqual([
      '若干',
      '恐慌',
      '恐怖',
      '恐懼',
      '不可能',
      '預期心理',
      '符合預期',
      '估計值',
    ])
  })
  it('every exception actually contains a marker it needs to shield', () => {
    // 例外清單存在的理由：純子字串比對會把「若干」當成「若」。若某個例外不含任何 marker，
    // 它就是誤加的——這條測試讓清單不會漂成一份無用的詞表。
    for (const ex of MARKER_EXCEPTIONS)
      expect(SPECULATIVE_MARKERS.some(m => ex.includes(m) && ex !== m)).toBe(true)
  })
  it('constants are frozen so callers cannot mutate the audit rules at runtime', () => {
    expect(Object.isFrozen(SPECULATIVE_MARKERS)).toBe(true)
    expect(Object.isFrozen(CONDITIONAL_MARKERS)).toBe(true)
    expect(Object.isFrozen(MARKER_EXCEPTIONS)).toBe(true)
  })
})
