import type { EvidenceClaim, Narrative, NarrativeSection } from '@suanomics/shared'
import { describe, expect, it, vi } from 'vitest'
import { checkNarrativeClaimBinding, warnClaimBindingIssues } from './narrative-claim-binding.js'

function claim(id: string, text: string): EvidenceClaim {
  return {
    id,
    kind: 'fact',
    claimType: 'named-number',
    claim: text,
    evidenceRefs: [],
    asOf: '2026-08-09',
    checks: [],
  }
}

function section(over: Partial<NarrativeSection> = {}): NarrativeSection {
  return {
    heading: '小標',
    body: '這段沒有任何數字。',
    takeaway: null,
    relatedNewsIds: [],
    claimIds: [],
    citationUrls: ['https://example.com/a'],
    ...over,
  }
}

function narrative(sections: NarrativeSection[]): Narrative {
  return { intro: '前言沒有數字。', outro: '結語沒有數字。', sections }
}

describe('checkNarrativeClaimBinding', () => {
  it('數字對回該 section 自己掛的 claim 時不算 unbound', () => {
    const ledger = [claim('c1', 'WTI 原油價格為每桶 81.96 美元。')]
    const n = narrative([section({ body: '油價本週降至每桶 81.96 美元。', claimIds: ['c1'] })])

    const r = checkNarrativeClaimBinding(n, ledger)

    expect(r.total).toBe(1)
    expect(r.unbound).toBe(0)
    expect(r.details).toEqual([])
  })

  // 這是 2026-08-09 prod brief 的實際樣態：body 用了 -429，而該 section 的 claimIds
  // 只掛了別的 claim。舊判準（對整個 ledger 池比對）會判為 matched、給出 97.6% 的漂亮數字，
  // 卻讓一句正負號相反的敘述通過。收緊的意義全在這一條。
  it('數字只對得回「別的 claim」而非本 section 掛的 claim 時算 unbound', () => {
    const ledger = [
      claim('c1', 'WTI 原油價格為每桶 81.96 美元。'),
      claim('c13', '2026 年 8 月 7 日三大法人買賣超為 -429 億元。'),
    ]
    const n = narrative([section({
      body: '在三大法人買賣超為 -429 億元的格局下，油價降至 81.96 美元。',
      claimIds: ['c1'],
    })])

    const r = checkNarrativeClaimBinding(n, ledger)

    expect(r.total).toBe(2)
    expect(r.unbound).toBe(1)
    expect(r.details).toHaveLength(1)
    expect(r.details[0]?.value).toBe(-429)
    expect(r.details[0]?.sectionIndex).toBe(0)
    expect(r.details[0]?.field).toBe('body')
  })

  it('數字對不回 ledger 裡任何 claim 時算 unbound', () => {
    const ledger = [claim('c1', 'WTI 原油價格為每桶 81.96 美元。')]
    const n = narrative([section({ body: '加權指數收在 44226 點。', claimIds: ['c1'] })])

    const r = checkNarrativeClaimBinding(n, ledger)

    expect(r.unbound).toBe(1)
    expect(r.details[0]?.value).toBe(44226)
  })

  it('section 沒掛任何 claimIds 時，它的數字全部算 unbound', () => {
    const ledger = [claim('c1', 'WTI 原油價格為每桶 81.96 美元。')]
    const n = narrative([section({ body: '油價降至 81.96 美元。', claimIds: [] })])

    const r = checkNarrativeClaimBinding(n, ledger)

    expect(r.total).toBe(1)
    expect(r.unbound).toBe(1)
  })

  it('ledger 為空時，narrative 的數字全部算 unbound', () => {
    const n = narrative([section({ body: '油價降至 81.96 美元。', claimIds: ['c1'] })])

    const r = checkNarrativeClaimBinding(n, [])

    expect(r.total).toBe(1)
    expect(r.unbound).toBe(1)
  })

  it('掛了 ledger 裡不存在的 claimId 時，不當作有掛載點', () => {
    const ledger = [claim('c1', 'WTI 原油價格為每桶 81.96 美元。')]
    const n = narrative([section({ body: '油價降至 81.96 美元。', claimIds: ['c999'] })])

    const r = checkNarrativeClaimBinding(n, ledger)

    expect(r.unbound).toBe(1)
  })

  it('heading 與 takeaway 也在檢查範圍內', () => {
    const ledger = [claim('c1', 'WTI 原油價格為每桶 81.96 美元。')]
    const n = narrative([section({
      heading: '油價回落至 70.11 美元',
      body: '油價降至 81.96 美元。',
      takeaway: '外資買超 903.08 億元。',
      claimIds: ['c1'],
    })])

    const r = checkNarrativeClaimBinding(n, ledger)

    expect(r.total).toBe(3)
    expect(r.unbound).toBe(2)
    expect(r.details.map(d => d.field).sort()).toEqual(['heading', 'takeaway'])
  })

  it('takeaway 為 null 時不計入', () => {
    const ledger = [claim('c1', 'WTI 原油價格為每桶 81.96 美元。')]
    const n = narrative([section({ body: '油價降至 81.96 美元。', takeaway: null, claimIds: ['c1'] })])

    const r = checkNarrativeClaimBinding(n, ledger)

    expect(r.total).toBe(1)
    expect(r.unbound).toBe(0)
  })

  // intro/outro 沒有 claimIds 這個掛載點，收緊判準對它們無從施力（這是明確的取捨）。
  // 排除的理由是**結構性的**：算進分母的話它們永遠是 unbound、沒有任何辦法變成 bound，
  // 那是固定噪音不是訊號。（實際量體很小——2026-08-09 那份的 intro/outro 受檢數字是 0。）
  it('intro 與 outro 不納入檢查（沒有 claimIds 掛載點）', () => {
    const ledger = [claim('c1', 'WTI 原油價格為每桶 81.96 美元。')]
    const n: Narrative = {
      intro: '前言提到 12345 這個數字。',
      outro: '結語提到 67890 這個數字。',
      sections: [section({ body: '油價降至 81.96 美元。', claimIds: ['c1'] })],
    }

    const r = checkNarrativeClaimBinding(n, ledger)

    expect(r.total).toBe(1)
    expect(r.unbound).toBe(0)
  })

  it('年份與曆日不算受檢數字（沿用 extractCheckedNumbers 的排除清單）', () => {
    const ledger = [claim('c1', 'WTI 原油價格為每桶 81.96 美元。')]
    const n = narrative([section({
      body: '2026 年 8 月 7 日的油價為每桶 81.96 美元。',
      claimIds: ['c1'],
    })])

    const r = checkNarrativeClaimBinding(n, ledger)

    expect(r.total).toBe(1)
    expect(r.unbound).toBe(0)
  })

  it('多個 section 各自獨立判定，不互相借用對方的 claim', () => {
    const ledger = [
      claim('c1', 'WTI 原油價格為每桶 81.96 美元。'),
      claim('c2', '外資買超 903.08 億元。'),
    ]
    const n = narrative([
      section({ body: '油價降至 81.96 美元。', claimIds: ['c1'] }),
      // 掛 c2 卻用了 c1 的數字：跨 section 借用要被抓出來
      section({ body: '油價仍在 81.96 美元。', claimIds: ['c2'] }),
    ])

    const r = checkNarrativeClaimBinding(n, ledger)

    expect(r.total).toBe(2)
    expect(r.unbound).toBe(1)
    expect(r.details[0]?.sectionIndex).toBe(1)
  })

  it('同一個數字在 claim 句中出現多個時，任一相符即算 bound', () => {
    const ledger = [claim('c1', '指數自 44226 點回落至 43800 點。')]
    const n = narrative([section({ body: '指數收在 43800 點。', claimIds: ['c1'] })])

    const r = checkNarrativeClaimBinding(n, ledger)

    expect(r.unbound).toBe(0)
  })

  it('沒有數字的 narrative 回傳 total=0、unbound=0', () => {
    const r = checkNarrativeClaimBinding(narrative([section()]), [])

    expect(r.total).toBe(0)
    expect(r.unbound).toBe(0)
  })
})

// 這是真正跑在 prod 的那一個：軟警告的價值全在「非 0 時留下查得動的訊號」，
// 只斷言檢查函式本身、不斷言警告輸出，等於沒有測到落地行為。
describe('warnClaimBindingIssues', () => {
  it('零命中且無截斷時完全不輸出（否則每日 log 會被無意義的 0/26 洗掉）', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    warnClaimBindingIssues({ total: 26, unbound: 0, details: [] }, 0)

    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('命中時輸出比例與可追回原文的逐筆明細', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    warnClaimBindingIssues({
      total: 26,
      unbound: 2,
      details: [
        { sectionIndex: 0, field: 'body', value: -429 },
        { sectionIndex: 1, field: 'takeaway', value: 44226 },
      ],
    }, 0)

    expect(spy).toHaveBeenCalledTimes(1)
    const msg = String(spy.mock.calls[0]?.[0])
    expect(msg).toContain('2/26')
    expect(msg).toContain('sec0.body=-429')
    expect(msg).toContain('sec1.takeaway=44226')
    spy.mockRestore()
  })

  // 截斷是判讀 unbound 的必要脈絡：同樣是 unbound 1，「模型亂用數字」與
  // 「模型宣稱了但被上限截掉」要採取的行動完全不同。
  it('有截斷時一起印，即使 unbound 為 0 也要出聲', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    warnClaimBindingIssues({ total: 17, unbound: 0, details: [] }, 3)

    expect(spy).toHaveBeenCalledTimes(1)
    const msg = String(spy.mock.calls[0]?.[0])
    expect(msg).toContain('unbound 0/17')
    expect(msg).toContain('3')
    spy.mockRestore()
  })

  it('unbound 與截斷同時發生時兩者都印', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    warnClaimBindingIssues({
      total: 17,
      unbound: 1,
      details: [{ sectionIndex: 0, field: 'body', value: 2.43 }],
    }, 2)

    expect(spy).toHaveBeenCalledTimes(1)
    const msg = String(spy.mock.calls[0]?.[0])
    expect(msg).toContain('unbound 1/17')
    expect(msg).toContain('2')
    expect(msg).toContain('sec0.body=2.43')
    spy.mockRestore()
  })
})
