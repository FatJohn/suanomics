import type { EvidenceContext } from './evidence-checks.js'
import type { EvidenceClaim } from './evidence-claim.js'
import { describe, expect, it } from 'vitest'
import { checkClaimCompliance, checkFactHasEvidence, filterValidRefs, reconcileKind, runDeterministicChecks } from './evidence-checks.js'

const CTX: EvidenceContext = {
  citations: [
    { url: 'https://example.com/a', quote: '台積電法說會上修全年資本支出' },
    { url: 'https://example.com/b', quote: '費城半導體指數收在 12,179.26 點' },
  ],
  seriesPoints: [
    { seriesId: 'us-sox', asOf: '2026-08-04', value: 12179.26 },
    { seriesId: 'us-nasdaq-comp', asOf: '2026-08-04', value: 26584.99 },
  ],
  knownSeriesIds: ['us-sox', 'us-nasdaq-comp', 'us-cpi-yoy'],
  calendarDates: ['2026-08-06'],
}

function claimOf(over: Partial<EvidenceClaim> = {}): EvidenceClaim {
  return {
    id: 'c1',
    kind: 'fact',
    claimType: 'named-number',
    claim: '費城半導體指數收在 12,179.26 點。',
    evidenceRefs: [{ kind: 'series', seriesId: 'us-sox', asOf: '2026-08-04' }],
    asOf: '2026-08-04',
    checks: [],
    ...over,
  }
}

// D2：citation ref 的 url 必須 ∈ brief.citations[].url
describe('filterValidRefs — D2 citation refs', () => {
  it('keeps a citation ref whose url is in brief.citations', () => {
    const r = filterValidRefs([{ kind: 'citation', url: 'https://example.com/a' }], CTX)
    expect(r.kept).toHaveLength(1)
    expect(r.dropped).toHaveLength(0)
  })
  it('drops a citation ref whose url is absent from brief.citations', () => {
    const r = filterValidRefs([{ kind: 'citation', url: 'https://evil.example/fake' }], CTX)
    expect(r.kept).toHaveLength(0)
    expect(r.dropped[0]?.check).toBe('D2')
  })
})

// D3：series ref 的 seriesId ∈ SERIES_SPECS，且 asOf 等於當日快照該序列的實際 as-of
describe('filterValidRefs — D3 series refs', () => {
  it('keeps a series ref matching a snapshot point exactly', () => {
    const r = filterValidRefs([{ kind: 'series', seriesId: 'us-sox', asOf: '2026-08-04' }], CTX)
    expect(r.kept).toHaveLength(1)
  })
  it('drops a series ref whose seriesId is not a known series', () => {
    const r = filterValidRefs([{ kind: 'series', seriesId: 'made-up-series', asOf: '2026-08-04' }], CTX)
    expect(r.kept).toHaveLength(0)
    expect(r.dropped[0]?.check).toBe('D3')
  })
  // 這條是「靜默沿用 T-1」那個 bug 的守衛：序列靜默沿用前一交易日時，asOf 會對不上，ref 必須被丟掉
  it('drops a series ref whose asOf differs from the snapshot as-of', () => {
    const r = filterValidRefs([{ kind: 'series', seriesId: 'us-sox', asOf: '2026-08-03' }], CTX)
    expect(r.kept).toHaveLength(0)
    expect(r.dropped[0]?.check).toBe('D3')
  })
  // 已知序列但當日快照沒餵進來（例如該序列當天抓取失敗）→ 一樣不能當證據
  it('drops a known series that is absent from the day snapshot', () => {
    const r = filterValidRefs([{ kind: 'series', seriesId: 'us-cpi-yoy', asOf: '2026-08-04' }], CTX)
    expect(r.kept).toHaveLength(0)
    expect(r.dropped[0]?.check).toBe('D3')
  })
})

describe('filterValidRefs — 混合與邊界', () => {
  it('keeps valid refs while dropping invalid ones in the same claim', () => {
    const r = filterValidRefs([
      { kind: 'citation', url: 'https://example.com/a' },
      { kind: 'citation', url: 'https://evil.example/fake' },
      { kind: 'series', seriesId: 'us-sox', asOf: '2026-08-04' },
      { kind: 'series', seriesId: 'us-sox', asOf: '1999-01-01' },
    ], CTX)
    expect(r.kept).toHaveLength(2)
    expect(r.dropped.map(d => d.check)).toEqual(['D2', 'D3'])
  })
  it('returns empty result for empty input', () => {
    const r = filterValidRefs([], CTX)
    expect(r.kept).toEqual([])
    expect(r.dropped).toEqual([])
  })
  it('does not mutate the input array', () => {
    const refs = [{ kind: 'citation' as const, url: 'https://evil.example/fake' }]
    filterValidRefs(refs, CTX)
    expect(refs).toHaveLength(1)
  })
})

// D1：kind 'fact' 必須有 ≥1 個 evidenceRef。走在 D2/D3 之後——先移除無效 ref 再判。
describe('checkFactHasEvidence — D1', () => {
  it('passes a fact claim that still has a ref after filtering', () => {
    expect(checkFactHasEvidence(claimOf())).toBe(true)
  })
  it('fails a fact claim with no refs', () => {
    expect(checkFactHasEvidence(claimOf({ evidenceRefs: [] }))).toBe(false)
  })
  // D1 只約束 fact；inference 與 scenario 沒有這條要求
  it('passes inference and scenario claims regardless of refs', () => {
    expect(checkFactHasEvidence(claimOf({ kind: 'inference', evidenceRefs: [] }))).toBe(true)
    expect(checkFactHasEvidence(claimOf({ kind: 'scenario', evidenceRefs: [] }))).toBe(true)
  })
  // 順序依賴：一個 fact 的唯一 ref 是幻覺 url，過 D2 後就沒有 ref 了 → D1 必須失敗
  it('fails a fact whose only ref is dropped by D2', () => {
    const claim = claimOf({ evidenceRefs: [{ kind: 'citation', url: 'https://evil.example/fake' }] })
    const filtered = { ...claim, evidenceRefs: filterValidRefs(claim.evidenceRefs, CTX).kept }
    expect(checkFactHasEvidence(filtered)).toBe(false)
  })
})

// D6：句型與 kind 一致。失敗處置是改判 kind、不刪句。
describe('reconcileKind — D6', () => {
  it('leaves a clean fact alone', () => {
    const r = reconcileKind(claimOf({ kind: 'fact', claim: '費半收在 12,179.26 點。' }))
    expect(r).toEqual({ kind: 'fact', changed: false })
  })
  it('reclassifies a fact carrying a speculative marker as inference', () => {
    const r = reconcileKind(claimOf({ kind: 'fact', claim: '半導體庫存去化可能延續到下季。' }))
    expect(r).toEqual({ kind: 'inference', changed: true })
  })
  it('reclassifies a speculative fact as scenario when it is also conditional', () => {
    const r = reconcileKind(claimOf({ kind: 'fact', claim: '若關稅落地，出口動能可能轉弱。' }))
    expect(r).toEqual({ kind: 'scenario', changed: true })
  })
  it('leaves a scenario alone when it carries a conditional marker', () => {
    expect(reconcileKind(claimOf({ kind: 'scenario', claim: '一旦升息循環結束，評價有望修復。' })).changed).toBe(false)
  })
  it('reclassifies a scenario without any conditional marker as inference', () => {
    const r = reconcileKind(claimOf({ kind: 'scenario', claim: '出口動能轉弱。' }))
    expect(r).toEqual({ kind: 'inference', changed: true })
  })
  it('never reclassifies an inference — it has no sentence-shape constraint', () => {
    expect(reconcileKind(claimOf({ kind: 'inference', claim: '若關稅落地，出口可能轉弱。' })).changed).toBe(false)
    expect(reconcileKind(claimOf({ kind: 'inference', claim: '出口動能轉弱。' })).changed).toBe(false)
  })

  // 斷詞：中文沒有詞界，純子字串比對會把「若干」當成「若」、「恐慌」當成「恐」，
  // 於是一句合法的 fact 被改判。MARKER_EXCEPTIONS 就是為了這個而存在。
  it('does not treat 若干 as the marker 若', () => {
    expect(reconcileKind(claimOf({ kind: 'fact', claim: '若干個股成交量放大。' })).changed).toBe(false)
  })
  it('does not treat 恐慌 / 恐懼 / 恐怖 as the marker 恐', () => {
    for (const s of ['市場恐慌情緒升溫。', '投資人恐懼指數走高。', '恐怖攻擊衝擊油價。'])
      expect(reconcileKind(claimOf({ kind: 'fact', claim: s })).changed).toBe(false)
  })
  it('still catches a real 恐 outside the exception words', () => {
    expect(reconcileKind(claimOf({ kind: 'fact', claim: '出口恐轉為衰退。' })).changed).toBe(true)
  })
  it('still catches a real 若 outside the exception words', () => {
    expect(reconcileKind(claimOf({ kind: 'fact', claim: '若庫存去化不如預期則評價下修。' })).changed).toBe(true)
  })
})

// D7：沿用既有合規處置，本層只回報命中
describe('checkClaimCompliance — D7', () => {
  it('passes a compliant sentence', () => {
    expect(checkClaimCompliance(claimOf({ claim: '費半收在 12,179.26 點。' })).passed).toBe(true)
  })
  it('flags a forbidden phrase and names it', () => {
    const r = checkClaimCompliance(claimOf({ claim: '此時建議買進半導體類股。' }))
    expect(r.passed).toBe(false)
    expect(r.phrase).toBe('建議買')
  })
})

describe('runDeterministicChecks — 組合', () => {
  it('records every check that ran and passed', () => {
    const r = runDeterministicChecks(claimOf(), CTX)
    expect(r.checks).toContain('D1')
    expect(r.checks).toContain('D3')
    expect(r.checks).toContain('D6')
    expect(r.checks).toContain('D7')
    expect(r.claim.checks).toEqual(r.checks)
  })
  // 順序依賴：D2/D3 先過濾 ref，D1 才判得準
  it('drops an invalid ref and then fails D1 for a fact left with nothing', () => {
    const claim = claimOf({ evidenceRefs: [{ kind: 'citation', url: 'https://evil.example/fake' }] })
    const r = runDeterministicChecks(claim, CTX)
    expect(r.claim.evidenceRefs).toHaveLength(0)
    expect(r.checks).not.toContain('D1')
    expect(r.findings.join(' ')).toContain('D1')
  })
  it('applies the D6 reclassification to the returned claim', () => {
    const r = runDeterministicChecks(claimOf({ kind: 'fact', claim: '出口恐轉為衰退。' }), CTX)
    expect(r.claim.kind).toBe('inference')
    expect(r.checks).toContain('D6')
  })
  // D4 只跑 named-number、D5 只跑 dated-event
  it('skips D4 for a causal claim and D5 for a non-dated one', () => {
    const r = runDeterministicChecks(claimOf({ claimType: 'causal', claim: '關稅推升成本。' }), CTX)
    expect(r.checks).not.toContain('D4')
    expect(r.checks).not.toContain('D5')
  })
  it('does not mutate the input claim', () => {
    const claim = claimOf({ kind: 'fact', claim: '出口恐轉為衰退。' })
    runDeterministicChecks(claim, CTX)
    expect(claim.kind).toBe('fact')
    expect(claim.checks).toEqual([])
  })
})

// 2026-08-05 驗收實測出來的誤判：這些詞含 marker 但語意不是臆測。
// 誤判的後果不只是分類錯——fact 被降級後 D1 就不再要求 evidence。
describe('reconcileKind — 複合詞誤判防護', () => {
  it('does not treat 不可能 / 預期心理 / 符合預期 / 估計值 as speculative', () => {
    for (const s of ['這在技術上不可能發生。', '預期心理升溫。', '結果符合預期。', '估計值為 3.2。'])
      expect(reconcileKind(claimOf({ kind: 'fact', claim: s })).changed).toBe(false)
  })
  it('still catches the bare markers those words contain', () => {
    for (const s of ['庫存去化可能延續。', '市場預期升息。', '估計出口轉弱。'])
      expect(reconcileKind(claimOf({ kind: 'fact', claim: s })).changed).toBe(true)
  })
  // 已知限制：例外清單是窮舉的，罕見詞（般若、奈若何）仍會誤判。
  // 財經文本不會出現，故不加進清單；這條測試存在是為了讓限制是被知道的、而不是被發現的。
  it('documented limitation: rare words containing a marker still misfire', () => {
    expect(reconcileKind(claimOf({ kind: 'fact', claim: '般若心經。' })).changed).toBe(true)
  })
})

describe('runDeterministicChecks — 三態與失敗處置', () => {
  // D2/D3 沒有對應 ref 時是「沒跑」，不是「通過」
  it('marks D2/D3 as skipped when the claim has no ref of that kind', () => {
    const r = runDeterministicChecks(claimOf({ evidenceRefs: [] }), CTX)
    expect(r.skipped).toContain('D2')
    expect(r.skipped).toContain('D3')
    expect(r.checks).not.toContain('D2')
    expect(r.checks).not.toContain('D3')
  })
  it('marks D3 as checked but D2 as skipped for a series-only claim', () => {
    const r = runDeterministicChecks(claimOf(), CTX)
    expect(r.checks).toContain('D3')
    expect(r.skipped).toContain('D2')
  })
  it('marks D1 as skipped for non-fact claims', () => {
    const r = runDeterministicChecks(claimOf({ kind: 'inference' }), CTX)
    expect(r.skipped).toContain('D1')
  })
  it('splits every check into exactly one of checks / failed / skipped', () => {
    const r = runDeterministicChecks(claimOf({ evidenceRefs: [] }), CTX)
    const all = [...r.checks, ...r.failed, ...r.skipped]
    expect(new Set(all).size).toBe(all.length)
    expect(new Set(all)).toEqual(new Set(['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7']))
  })

  // D4／D5 失敗的處置是「不得以 fact 發佈」——要真的降下來，不能只寫 findings
  it('demotes a fact to inference when D4 fails', () => {
    const r = runDeterministicChecks(claimOf({ claim: '費半收在 12,180.99 點。' }), CTX)
    expect(r.failed).toContain('D4')
    expect(r.claim.kind).toBe('inference')
  })
  it('demotes a fact to inference when D5 fails', () => {
    const claim = claimOf({ claimType: 'dated-event', claim: '2026-12-25 將公布財報。' })
    const r = runDeterministicChecks(claim, CTX)
    expect(r.failed).toContain('D5')
    expect(r.claim.kind).toBe('inference')
  })
  it('leaves a non-fact claim alone when D4 fails', () => {
    const r = runDeterministicChecks(claimOf({ kind: 'scenario', claim: '若關稅落地，費半恐跌至 9,999 點。' }), CTX)
    expect(r.failed).toContain('D4')
    expect(r.claim.kind).toBe('scenario')
  })
})
