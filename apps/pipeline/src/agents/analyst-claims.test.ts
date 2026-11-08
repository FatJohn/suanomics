import type { SeriesAnchor } from '@suanomics/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { claimsAutoAttachStats, claimsEnabled, claimsRejectedTotal, normalizeClaims, renderCitableSeriesSection, resetClaimsAutoAttachStats, resetClaimsRejectedTotal } from './analyst-claims.js'

const BRIEF_DATE = '2026-08-05'

describe('claimsEnabled', () => {
  beforeEach(() => {
    delete process.env.ANALYST_CLAIMS_ENABLED
  })

  it('預設關閉（未設 env）', () => {
    expect(claimsEnabled()).toBe(false)
  })

  it('只有字串 true 才算開（不接受 1／yes／TRUE／空字串）', () => {
    process.env.ANALYST_CLAIMS_ENABLED = 'true'
    expect(claimsEnabled()).toBe(true)
    for (const v of ['1', 'yes', 'TRUE', '']) {
      process.env.ANALYST_CLAIMS_ENABLED = v
      expect(claimsEnabled()).toBe(false)
    }
  })
})

describe('renderCitableSeriesSection', () => {
  it('列出 seriesId + displayName + asOf', () => {
    const lines: string[] = []
    renderCitableSeriesSection(lines, [
      { seriesId: 'us-sox', displayName: '費城半導體指數', asOf: '2026-08-04' },
      { seriesId: 'taiex-close', displayName: '加權指數', asOf: '2026-08-05' },
    ])
    const text = lines.join('\n')
    expect(text).toContain('# 可引用序列')
    expect(text).toContain('- seriesId: us-sox ｜ 費城半導體指數 ｜ asOf: 2026-08-04')
    expect(text).toContain('- seriesId: taiex-close ｜ 加權指數 ｜ asOf: 2026-08-05')
  })

  it('空清單時整段不出現（不留空標題）', () => {
    const lines: string[] = []
    renderCitableSeriesSection(lines, [])
    expect(lines).toEqual([])
  })
})

describe('normalizeClaims 的降級', () => {
  it('非陣列（含 undefined / null / 物件）一律視為空陣列', () => {
    for (const raw of [undefined, null, {}, 'x', 3]) {
      expect(normalizeClaims(raw, BRIEF_DATE, [])).toEqual([])
    }
  })

  it('壞的 claim 只丟該條、其餘保留', () => {
    const out = normalizeClaims([
      { kind: 'fact', claimType: 'named-number', claim: '費半收 11430.35 點', evidenceRefs: [] },
      { kind: '不存在的 kind', claimType: 'causal', claim: '壞的', evidenceRefs: [] },
      { kind: 'inference', claimType: 'causal', claim: '好的第二條', evidenceRefs: [] },
    ], BRIEF_DATE, [])
    expect(out.map(c => c.claim)).toEqual(['費半收 11430.35 點', '好的第二條'])
  })
})

describe('normalizeClaims 的 id 指派', () => {
  it('一律覆寫成 c1…cN，即使 LLM 送了重複 id', () => {
    const out = normalizeClaims([
      { id: 'c1', kind: 'fact', claimType: 'causal', claim: 'a', evidenceRefs: [] },
      { id: 'c1', kind: 'fact', claimType: 'causal', claim: 'b', evidenceRefs: [] },
      { id: 'c1', kind: 'fact', claimType: 'causal', claim: 'c', evidenceRefs: [] },
    ], BRIEF_DATE, [])
    expect(out.map(c => c.id)).toEqual(['c1', 'c2', 'c3'])
  })

  // 這條是安全性測試、不是整潔度測試：D4 會把 claim 自己的 id 整段從受檢數字中遮蔽，
  // 所以數字型 id 會讓句中同形的真數字靜默不受檢。
  it('數字型 id 被覆寫（否則句中同形數字會靜默不受檢）', () => {
    const out = normalizeClaims([
      { id: '4.25', kind: 'fact', claimType: 'named-number', claim: '費半下跌 4.25%', evidenceRefs: [] },
    ], BRIEF_DATE, [])
    expect(out[0]?.id).toBe('c1')
  })

  it('丟掉壞 claim 之後編號仍連續', () => {
    const out = normalizeClaims([
      { kind: 'fact', claimType: 'causal', claim: 'a', evidenceRefs: [] },
      { kind: 'bad', claimType: 'causal', claim: 'x', evidenceRefs: [] },
      { kind: 'fact', claimType: 'causal', claim: 'b', evidenceRefs: [] },
    ], BRIEF_DATE, [])
    expect(out.map(c => c.id)).toEqual(['c1', 'c2'])
  })
})

describe('normalizeClaims 的 asOf 推導', () => {
  it('有 series ref 時取其中最大的 asOf', () => {
    const out = normalizeClaims([{
      kind: 'fact',
      claimType: 'named-number',
      claim: 'x',
      evidenceRefs: [
        { kind: 'series', seriesId: 'us-sox', asOf: '2026-08-01' },
        { kind: 'series', seriesId: 'taiex-close', asOf: '2026-08-04' },
      ],
    }], BRIEF_DATE, [])
    expect(out[0]?.asOf).toBe('2026-08-04')
  })

  it('無 series ref 時取 briefDate', () => {
    const out = normalizeClaims([{
      kind: 'fact',
      claimType: 'causal',
      claim: 'x',
      evidenceRefs: [{ kind: 'citation', url: 'https://example.com/a' }],
    }], BRIEF_DATE, [])
    expect(out[0]?.asOf).toBe(BRIEF_DATE)
  })
})

describe('normalizeClaims 的 ref 收斂', () => {
  it('組不出合法 ref 的丟掉該 ref、同一條 claim 的其餘 ref 保留', () => {
    const out = normalizeClaims([{
      kind: 'fact',
      claimType: 'named-number',
      claim: 'x',
      evidenceRefs: [
        { kind: 'citation' }, //                                   缺 url
        { kind: 'citation', url: '不是 url' }, //                  url 不合法
        { kind: 'series', seriesId: 'us-sox' }, //                 缺 asOf
        { kind: 'series', seriesId: 'us-sox', asOf: '8/4/2026' }, // asOf 格式錯
        { kind: '既不是 citation 也不是 series' },
        { kind: 'citation', url: 'https://example.com/a' }, //     合法
        { kind: 'series', seriesId: 'us-sox', asOf: '2026-08-04' }, // 合法
      ],
    }], BRIEF_DATE, [])
    expect(out[0]?.evidenceRefs).toEqual([
      { kind: 'citation', url: 'https://example.com/a' },
      { kind: 'series', seriesId: 'us-sox', asOf: '2026-08-04' },
    ])
  })

  it('ref 全壞不會丟掉整條 claim（空 evidenceRefs 是 D1 要判的狀態、不是 schema 的事）', () => {
    const out = normalizeClaims([{
      kind: 'fact',
      claimType: 'named-number',
      claim: 'x',
      evidenceRefs: [{ kind: 'citation' }],
    }], BRIEF_DATE, [])
    expect(out).toHaveLength(1)
    expect(out[0]?.evidenceRefs).toEqual([])
  })
})

describe('normalizeClaims 的契約防衛', () => {
  it('剝除 LLM 自報的 checks（契約規定它由 deterministic 檢查回填）', () => {
    const out = normalizeClaims([{
      kind: 'fact',
      claimType: 'causal',
      claim: 'x',
      evidenceRefs: [],
      checks: ['D4', 'D7'],
    }], BRIEF_DATE, [])
    expect(out[0]?.checks).toEqual([])
  })

  it('超過 30 條時截斷並出聲（靜默截斷會被讀成涵蓋完整）', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const many = Array.from({ length: 42 }, (_, i) => ({
      kind: 'fact',
      claimType: 'causal',
      claim: `第 ${i} 條`,
      evidenceRefs: [],
    }))
    const out = normalizeClaims(many, BRIEF_DATE, [])
    expect(out).toHaveLength(30)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('42'))
    warnSpy.mockRestore()
  })

  it('剛好 30 條不出聲', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const many = Array.from({ length: 30 }, (_, i) => ({
      kind: 'fact',
      claimType: 'causal',
      claim: `第 ${i} 條`,
      evidenceRefs: [],
    }))
    expect(normalizeClaims(many, BRIEF_DATE, [])).toHaveLength(30)
    expect(warnSpy).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})

// 量測報告要出「claim safeParse 淘汰數」。原本那句話指向一個
// 永遠不會出現的 stderr warn——淘汰路徑既不計數也不出聲（2026-08-05 驗收抓到）。
describe('safeParse 淘汰的可觀測性', () => {
  beforeEach(() => resetClaimsRejectedTotal())

  it('淘汰數被累計且出聲', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const out = normalizeClaims([
      { kind: 'fact', claimType: 'causal', claim: '好的', evidenceRefs: [] },
      { kind: '壞 kind', claimType: 'causal', claim: 'x', evidenceRefs: [] },
      { kind: 'fact', claimType: '壞 type', claim: 'y', evidenceRefs: [] },
    ], BRIEF_DATE, [])
    expect(out).toHaveLength(1)
    expect(claimsRejectedTotal()).toBe(2)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('2 條 claim 未通過 schema'))
    warnSpy.mockRestore()
  })

  it('全部合法時不計數也不出聲', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    normalizeClaims([{ kind: 'fact', claimType: 'causal', claim: '好的', evidenceRefs: [] }], BRIEF_DATE, [])
    expect(claimsRejectedTotal()).toBe(0)
    expect(warnSpy).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  // 這條擋的是「產出率 0% 被讀成模型不產 claim」——實際原因是呼叫端傳了壞的 briefDate。
  it('briefDate 非法時出聲（否則無 series ref 的 claim 靜默全滅）', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const out = normalizeClaims([
      { kind: 'fact', claimType: 'causal', claim: 'x', evidenceRefs: [] },
    ], 'not-a-date', [])
    expect(out).toEqual([])
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('briefDate 格式非法'))
    warnSpy.mockRestore()
  })
})

const ANCHORS = [
  { seriesId: 'us-sox', displayName: '費城半導體指數', asOf: '2026-07-24', value: 10447.49, displayValue: 10447 },
  { seriesId: 'us-cpi-yoy', displayName: 'CPI 年增率', asOf: '2026-05-01', value: 3.1, displayValue: 3.1 },
] satisfies SeriesAnchor[]

function claimNode(claim: string, evidenceRefs: unknown[] = []) {
  return { kind: 'fact', claimType: 'named-number', claim, evidenceRefs }
}

describe('normalizeClaims 的 monthly asOf snap', () => {
  // block 對 monthly 印「2026-05」，可引用清單給「2026-05-01」。模型抄 block 那一側，
  // 之前會在 convergeRef 被 schema 靜默丟掉——連 D3 都看不到，claim 看起來像沒掛 ref。
  it('snaps a YYYY-MM as-of onto the real as-of of that series', () => {
    const out = normalizeClaims([
      claimNode('CPI 年增率為 3.1%。', [{ kind: 'series', seriesId: 'us-cpi-yoy', asOf: '2026-05' }]),
    ], BRIEF_DATE, ANCHORS)
    expect(out[0]?.evidenceRefs).toEqual([{ kind: 'series', seriesId: 'us-cpi-yoy', asOf: '2026-05-01' }])
  })

  // 這條的 claim 句**刻意不含任何受檢數字**：帶數字的話 auto-attach 會補回一個合法 ref，
  // 於是「錯月份沒被 snap」與「錯月份被 snap 成 2026-05-01」的端到端結果一模一樣，
  // 測試就擋不住那個坑（獨立複查 2026-08-05 實測：把月份比對拿掉，25 個測試照樣全綠）。
  it('does not snap a different month（錯月份的 ref 必須整個消失）', () => {
    const out = normalizeClaims([
      claimNode('CPI 年增率較前月回落。', [{ kind: 'series', seriesId: 'us-cpi-yoy', asOf: '2026-04' }]),
    ], BRIEF_DATE, ANCHORS)
    expect(out[0]?.evidenceRefs).toEqual([])
  })

  it('snaps the right month even without any number to auto-attach', () => {
    const out = normalizeClaims([
      claimNode('CPI 年增率較前月回落。', [{ kind: 'series', seriesId: 'us-cpi-yoy', asOf: '2026-05' }]),
    ], BRIEF_DATE, ANCHORS)
    expect(out[0]?.evidenceRefs).toEqual([{ kind: 'series', seriesId: 'us-cpi-yoy', asOf: '2026-05-01' }])
  })

  it('does not snap an unknown series', () => {
    const out = normalizeClaims([
      claimNode('某指數為 3.1%。', [{ kind: 'series', seriesId: 'not-a-series', asOf: '2026-05' }]),
    ], BRIEF_DATE, ANCHORS)
    expect(out[0]?.evidenceRefs).toEqual([])
  })
})

describe('normalizeClaims 的 auto-attach', () => {
  it('attaches the series ref the model left off', () => {
    const out = normalizeClaims([
      claimNode('2026 年 7 月 24 日，費城半導體指數收於 10,447 點。'),
    ], BRIEF_DATE, ANCHORS)
    expect(out[0]?.evidenceRefs).toEqual([{ kind: 'series', seriesId: 'us-sox', asOf: '2026-07-24' }])
  })

  it('runs after id assignment so the claim id never masks a real number', () => {
    const out = normalizeClaims([
      claimNode('費城半導體指數收於 10,447 點。'),
      claimNode('費城半導體指數前一日為 10,447.49 點。'),
    ], BRIEF_DATE, ANCHORS)
    expect(out.map(c => c.id)).toEqual(['c1', 'c2'])
    expect(out.every(c => c.evidenceRefs.length === 1)).toBe(true)
  })

  it('attaches nothing when no anchors are supplied', () => {
    const out = normalizeClaims([
      claimNode('費城半導體指數收於 10,447 點。'),
    ], BRIEF_DATE, [])
    expect(out[0]?.evidenceRefs).toEqual([])
  })
})

// 這三個計數器是量測報告拆解 D1 的唯一依據——沒有它們，新的 D1 分不出模型自掛與機器補的。
describe('claimsAutoAttachStats', () => {
  beforeEach(() => resetClaimsAutoAttachStats())

  it('counts only fact claims that went from zero refs to some', () => {
    normalizeClaims([
      claimNode('費城半導體指數收於 10,447 點。'),
      { ...claimNode('費城半導體指數可能續跌至 10,447 點。'), kind: 'inference' },
    ], BRIEF_DATE, ANCHORS)
    const s = claimsAutoAttachStats()
    expect(s.refs).toBe(2)
    // inference 也掛到 ref，但 D1 的分母只有 fact，混進來會讓報告的減法扣過頭
    expect(s.groundedFactClaims).toBe(1)
  })

  it('accumulates across calls and resets to zero', () => {
    normalizeClaims([claimNode('費城半導體指數收於 10,447 點。')], BRIEF_DATE, ANCHORS)
    normalizeClaims([claimNode('費城半導體指數收於 10,447 點。')], BRIEF_DATE, ANCHORS)
    expect(claimsAutoAttachStats()).toEqual({ refs: 2, groundedFactClaims: 2, ambiguous: 0 })
    resetClaimsAutoAttachStats()
    expect(claimsAutoAttachStats()).toEqual({ refs: 0, groundedFactClaims: 0, ambiguous: 0 })
  })

  it('counts an ambiguous number instead of attaching it', () => {
    const tied = [
      { seriesId: 'us-10y-yield', displayName: '美債 10 年期殖利率', asOf: '2026-07-24', value: 4.32, displayValue: 4.32 },
      { seriesId: 'us-2y-yield', displayName: '美債 2 年期殖利率', asOf: '2026-07-24', value: 4.32, displayValue: 4.32 },
    ] satisfies SeriesAnchor[]
    const out = normalizeClaims([
      claimNode('美債 10 年期殖利率與美債 2 年期殖利率同為 4.32%'),
    ], BRIEF_DATE, tied)
    expect(out[0]?.evidenceRefs).toEqual([])
    expect(claimsAutoAttachStats()).toEqual({ refs: 0, groundedFactClaims: 0, ambiguous: 1 })
  })
})
