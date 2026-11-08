import type { EvidenceClaim } from './evidence-claim.js'
import { describe, expect, it } from 'vitest'
import { buildClaimLedger, formatClaimLedgerBlock } from './evidence-ledger.js'

// 各測試只覆寫它關心的欄位；id 一律給假值，因為 ledger 的職責之一就是重編號。
function claim(patch: Partial<EvidenceClaim> = {}): EvidenceClaim {
  return {
    id: 'c1',
    kind: 'fact',
    claimType: 'named-number',
    claim: '費半收 11,430.35 點',
    evidenceRefs: [],
    asOf: '2026-08-07',
    checks: [],
    ...patch,
  }
}

describe('buildClaimLedger', () => {
  it('回空 ledger（沒有任何來源）', () => {
    expect(buildClaimLedger([])).toEqual({ claims: [], sourceCount: 0, droppedDuplicates: 0 })
  })

  it('來源全是空陣列時 sourceCount 仍算數（分母不是「有產出的來源數」）', () => {
    const ledger = buildClaimLedger([[], []])
    expect(ledger.sourceCount).toBe(2)
    expect(ledger.claims).toEqual([])
  })

  // 這是本函式存在的首要理由：analyst-claims.ts 是每則新聞各自從 c1 編起。
  it('跨來源撞號的 id 重編為 c1..cN，順序＝(來源順序, 來源內順序)', () => {
    const ledger = buildClaimLedger([
      [claim({ id: 'c1', claim: 'A' }), claim({ id: 'c2', claim: 'B' })],
      [claim({ id: 'c1', claim: 'C' })],
    ])
    expect(ledger.claims.map(c => [c.id, c.claim])).toEqual([['c1', 'A'], ['c2', 'B'], ['c3', 'C']])
  })

  it('原始 id 不保留（ledger 尺度下沒有意義，留著會被誤當索引）', () => {
    const ledger = buildClaimLedger([[claim({ id: 'zzz-99', claim: 'A' })]])
    expect(ledger.claims[0]?.id).toBe('c1')
  })

  it('同 claimType 與正規化文字視為同一條，droppedDuplicates 計數', () => {
    const ledger = buildClaimLedger([
      [claim({ claim: '台積電 7 月營收年增 30%' })],
      [claim({ claim: '台積電 7 月營收年增 30%' })],
    ])
    expect(ledger.claims).toHaveLength(1)
    expect(ledger.droppedDuplicates).toBe(1)
  })

  // 正規化重用 evidence-number-check 的 normalizeText，與 D4 判定同一套。
  it.each([
    ['全形數字', '費半收 １１４３０ 點', '費半收 11430 點'],
    ['全形百分比', '年增 ３０％', '年增 30%'],
    ['全形句點', '收 １１４３０．３５ 點', '收 11430.35 點'],
    ['全形負號', '月減 －５%', '月減 -5%'],
    ['全形千分位逗號', '收 １１，４３０ 點', '收 11,430 點'],
    ['頭尾空白', '  收 11430 點  ', '收 11430 點'],
  ])('%s 的差異不算兩條', (_label, a, b) => {
    const ledger = buildClaimLedger([[claim({ claim: a })], [claim({ claim: b })]])
    expect(ledger.claims).toHaveLength(1)
  })

  it('claimType 不同就不合併（文字相同也一樣）', () => {
    const ledger = buildClaimLedger([
      [claim({ claim: '同一句', claimType: 'named-number' })],
      [claim({ claim: '同一句', claimType: 'causal' })],
    ])
    expect(ledger.claims).toHaveLength(2)
    expect(ledger.droppedDuplicates).toBe(0)
  })

  // key 刻意不含 asOf：它取自各次抓到的 series as-of，放進 key 會讓該合併的分家。
  it('asOf 不同仍合併，且取最新的那一個', () => {
    const ledger = buildClaimLedger([
      [claim({ claim: '同一句', asOf: '2026-08-05' })],
      [claim({ claim: '同一句', asOf: '2026-08-07' })],
    ])
    expect(ledger.claims).toHaveLength(1)
    expect(ledger.claims[0]?.asOf).toBe('2026-08-07')
  })

  it('合併時 evidenceRefs 取聯集，citation 比 url', () => {
    const ledger = buildClaimLedger([
      [claim({ claim: 'X', evidenceRefs: [{ kind: 'citation', url: 'https://a.example/1' }] })],
      [claim({ claim: 'X', evidenceRefs: [
        { kind: 'citation', url: 'https://a.example/1' },
        { kind: 'citation', url: 'https://b.example/2' },
      ] })],
    ])
    expect(ledger.claims[0]?.evidenceRefs).toEqual([
      { kind: 'citation', url: 'https://a.example/1' },
      { kind: 'citation', url: 'https://b.example/2' },
    ])
  })

  it('合併時 series ref 以 seriesId + asOf 判重（同 id 不同 asOf 是兩筆）', () => {
    const ledger = buildClaimLedger([
      [claim({ claim: 'X', evidenceRefs: [{ kind: 'series', seriesId: 'us-sox', asOf: '2026-08-06' }] })],
      [claim({ claim: 'X', evidenceRefs: [
        { kind: 'series', seriesId: 'us-sox', asOf: '2026-08-06' },
        { kind: 'series', seriesId: 'us-sox', asOf: '2026-08-07' },
      ] })],
    ])
    expect(ledger.claims[0]?.evidenceRefs).toEqual([
      { kind: 'series', seriesId: 'us-sox', asOf: '2026-08-06' },
      { kind: 'series', seriesId: 'us-sox', asOf: '2026-08-07' },
    ])
  })

  it.each([
    ['fact + inference', 'fact', 'inference', 'inference'],
    ['inference + scenario', 'inference', 'scenario', 'scenario'],
    ['fact + scenario', 'fact', 'scenario', 'scenario'],
    ['順序相反也一樣保守', 'scenario', 'fact', 'scenario'],
  ] as const)('kind 衝突取較保守者：%s', (_label, a, b, expected) => {
    const ledger = buildClaimLedger([
      [claim({ claim: 'X', kind: a })],
      [claim({ claim: 'X', kind: b })],
    ])
    expect(ledger.claims[0]?.kind).toBe(expected)
  })

  it('單一來源不降級（保守規則只在合併時生效）', () => {
    const ledger = buildClaimLedger([[claim({ kind: 'fact' })]])
    expect(ledger.claims[0]?.kind).toBe('fact')
  })

  // checks 在 pipeline 一律是空陣列（analyst-claims.ts:205），回填留待之後補上。
  // 這裡釘住「不做交集也不做聯集」，避免有人日後把它改成看似嚴謹的死規則。
  it('合併時 checks 取第一條、不做交集或聯集', () => {
    const ledger = buildClaimLedger([
      [claim({ claim: 'X', checks: ['D1'] })],
      [claim({ claim: 'X', checks: ['D4'] })],
    ])
    expect(ledger.claims[0]?.checks).toEqual(['D1'])
  })

  it('三個來源都有同一條時只留一條、droppedDuplicates 為 2', () => {
    const ledger = buildClaimLedger([
      [claim({ claim: 'X' })],
      [claim({ claim: 'X' })],
      [claim({ claim: 'X' })],
    ])
    expect(ledger.claims).toHaveLength(1)
    expect(ledger.droppedDuplicates).toBe(2)
    expect(ledger.sourceCount).toBe(3)
  })

  it('合併後的位置由首次出現決定，不會被後來的重複往後推', () => {
    const ledger = buildClaimLedger([
      [claim({ claim: 'A' }), claim({ claim: 'B' })],
      [claim({ claim: 'A' })],
    ])
    expect(ledger.claims.map(c => c.claim)).toEqual(['A', 'B'])
  })

  // claim 是疊加層：任何自行組出 AnalystOutput 的呼叫端都會讓這裡拿到 undefined
  // （`.default([])` 只在走過 Zod parse 時生效），而附加功能不該有權殺掉整份 brief。
  it.each([[undefined], [null]])('缺項來源當成沒有 claim，不 throw（%s）', (missing) => {
    const ledger = buildClaimLedger([missing, [claim({ claim: 'A' })]])
    expect(ledger.claims.map(c => c.claim)).toEqual(['A'])
    expect(ledger.sourceCount).toBe(2)
  })

  it('不改動輸入（純函式）', () => {
    const input = [[claim({ id: 'c1', claim: 'A' })]]
    const snapshot = JSON.parse(JSON.stringify(input)) as unknown
    buildClaimLedger(input)
    expect(input).toEqual(snapshot)
  })
})

describe('formatClaimLedgerBlock', () => {
  it('沒有 claim 時回空字串（呼叫端據此整段略過，比照既有 block 慣例）', () => {
    expect(formatClaimLedgerBlock(buildClaimLedger([]).claims)).toBe('')
  })

  it('一條 claim 一行，帶 id、kind/claimType 與來源', () => {
    const ledger = buildClaimLedger([[claim({
      claim: '費半收 11,430.35 點',
      kind: 'fact',
      claimType: 'named-number',
      evidenceRefs: [{ kind: 'series', seriesId: 'us-sox', asOf: '2026-08-07' }],
    })]])
    expect(formatClaimLedgerBlock(ledger.claims)).toContain('[c1] (fact/named-number) 費半收 11,430.35 點 — 來源：us-sox@2026-08-07')
  })

  it('citation ref 印 url', () => {
    const ledger = buildClaimLedger([[claim({
      claim: 'X',
      evidenceRefs: [{ kind: 'citation', url: 'https://a.example/1' }],
    })]])
    expect(formatClaimLedgerBlock(ledger.claims)).toContain('來源：https://a.example/1')
  })

  it('多個 ref 以頓號串接，順序同 evidenceRefs', () => {
    const ledger = buildClaimLedger([[claim({
      claim: 'X',
      evidenceRefs: [
        { kind: 'series', seriesId: 'us-sox', asOf: '2026-08-07' },
        { kind: 'citation', url: 'https://a.example/1' },
      ],
    })]])
    expect(formatClaimLedgerBlock(ledger.claims)).toContain('來源：us-sox@2026-08-07、https://a.example/1')
  })

  // 無 ref 的 claim 仍要印出來：它存在但沒證據，正是 D1 要抓的狀態，
  // 從 block 裡消失會讓 narrative 以為它不存在、也讓人事後查不到。
  it('沒有 ref 的 claim 仍列出並標記無來源', () => {
    const ledger = buildClaimLedger([[claim({ claim: 'X', evidenceRefs: [] })]])
    const block = formatClaimLedgerBlock(ledger.claims)
    expect(block).toContain('[c1]')
    expect(block).toContain('來源：（無）')
  })

  it('多條 claim 每條各一行', () => {
    const ledger = buildClaimLedger([[claim({ claim: 'A' }), claim({ claim: 'B' })]])
    expect(formatClaimLedgerBlock(ledger.claims).split('\n').filter(l => l.startsWith('['))).toHaveLength(2)
  })
})
