import type { EvidenceClaim } from '@suanomics/shared'
import { describe, expect, it } from 'vitest'
import { preNormalizeNarrativeRaw } from './narrative-writer.normalize.js'

// ledger fixture：id 與 citation ref 是這幾個 describe 唯一用得到的欄位，其餘給合法定值
function claimOf(id: string, citationUrls: string[] = []): EvidenceClaim {
  return {
    id,
    kind: 'fact',
    claimType: 'named-number',
    claim: `claim ${id}`,
    evidenceRefs: citationUrls.map(url => ({ kind: 'citation' as const, url })),
    asOf: '2026-06-27',
    checks: [],
  }
}

describe('preNormalizeNarrativeRaw control-char hygiene', () => {
  it('strips control chars from intro / section / outro before truncate', () => {
    const raw = {
      intro: '\u4ECA\u65E5\u001A\u79D1\u6280\u677F\u584A\u5448\u73FE\u5206\u5316\u3002',
      sections: [{ heading: 'AI \u7B97\u200B\u529B', body: '\u8F1D\u9054 GTC \u91CB\u51FA\u9032\u5EA6\u3002\uFFFD', relatedNewsIds: ['n1'], citationUrls: ['https://example.com/a'] }],
      outro: '\u79D1\u6280\u8207\u5730\u7DE3\u98A8\u96AA\u4F75\u884C\u3002\uFEFF',
    }
    const out = preNormalizeNarrativeRaw(raw, { validUrls: ['https://example.com/a'], validNewsIds: ['n1'], claimLedger: [] }).narrative as {
      intro: string
      sections: Array<{ heading: string, body: string }>
      outro: string
    }
    expect(out.intro).toBe('\u4ECA\u65E5\u79D1\u6280\u677F\u584A\u5448\u73FE\u5206\u5316\u3002')
    expect(out.sections[0]?.heading).toBe('AI \u7B97\u529B')
    expect(out.sections[0]?.body).not.toContain('\uFFFD')
    expect(out.outro).not.toContain('\uFEFF')
  })
})

// \u8B80\u8005\u9762\u300C\u4E00\u53E5\u8A71\u7D50\u8AD6\u300D\uFF1Aschema \u662F nullable\u3001\u6240\u4EE5\u4EFB\u4F55\u4E0D\u5408\u683C\u7684\u503C\u90FD\u8A72\u6536\u6582\u6210 null
// \u800C\u4E0D\u662F\u8B93\u6574\u4EFD narrative \u88AB Zod reject\uFF08degrade \u7684\u7C92\u5EA6\u662F\u9019\u4E00\u53E5\u3001\u4E0D\u662F\u6574\u7BC7\uFF09
describe('preNormalizeNarrativeRaw takeaway', () => {
  const base = { heading: '\u6A19\u984C', body: '\u5167\u6587', relatedNewsIds: ['n1'], citationUrls: ['https://example.com/a'] }
  function run(takeaway: unknown) {
    const raw = { intro: '\u5C0E\u8A00\u3002', sections: [{ ...base, takeaway }], outro: '\u7D50\u8A9E\u3002' }
    const out = preNormalizeNarrativeRaw(raw, { validUrls: ['https://example.com/a'], validNewsIds: ['n1'], claimLedger: [] }).narrative as {
      sections: Array<{ takeaway: string | null }>
    }
    return out.sections[0]?.takeaway
  }

  it('keeps a well-formed takeaway as-is', () => {
    const t = '\u7D05\u6D77\u885D\u7A81\u8B93\u6CB9\u50F9\u5730\u7DE3\u6EA2\u50F9\u6C92\u6709\u5982\u9810\u671F\u6D88\u9000\uFF0CWTI \u6490\u5728 84.38 \u7F8E\u5143\u3002'
    expect(run(t)).toBe(t)
  })
  it('truncates an over-long takeaway to the last full sentence within 70', () => {
    const t = `${'\u4E00'.repeat(28)}\u3002${'\u4E8C'.repeat(50)}\u3002`
    const got = run(t)
    expect(got).toBe(`${'\u4E00'.repeat(28)}\u3002`)
    expect((got ?? '').length).toBeLessThanOrEqual(70)
  })
  it('degrades to null when an over-long takeaway has no sentence boundary to cut at', () => {
    // 句中截斷的殘句不該出現在讀者面的粗體結論行——寧可整句不顯示
    expect(run('一'.repeat(80))).toBeNull()
  })
  it('maps empty string to null', () => {
    expect(run('')).toBeNull()
  })
  it('maps whitespace-only to null', () => {
    expect(run('\u3000 \n')).toBeNull()
  })
  it('maps a non-string to null', () => {
    expect(run(42)).toBeNull()
  })
  it('maps a missing takeaway to null', () => {
    const raw = { intro: '\u5C0E\u8A00\u3002', sections: [{ ...base }], outro: '\u7D50\u8A9E\u3002' }
    const out = preNormalizeNarrativeRaw(raw, { validUrls: ['https://example.com/a'], validNewsIds: ['n1'], claimLedger: [] }).narrative as {
      sections: Array<{ takeaway: string | null }>
    }
    expect(out.sections[0]?.takeaway).toBeNull()
  })
})

// LLM 回的 claimIds 可能含 ledger 裡不存在的 id（幻覺或編號漂移）。
// 策略比照既有的 relatedNewsIds／fabrication strip：strip 掉、記數、不讓整份 narrative 失敗。
describe('preNormalizeNarrativeRaw claimIds', () => {
  const base = { heading: '標題', body: '內文', relatedNewsIds: ['n1'], citationUrls: ['https://example.com/a'] }
  function run(sections: unknown[], ledgerIds: string[]) {
    const raw = { intro: '導言。', sections, outro: '結語。' }
    const out = preNormalizeNarrativeRaw(raw, {
      validUrls: ['https://example.com/a'],
      validNewsIds: ['n1'],
      claimLedger: ledgerIds.map(id => claimOf(id)),
    })
    return {
      claimIds: (out.narrative as { sections: Array<{ claimIds?: unknown }> }).sections.map(s => s.claimIds),
      stripped: out.claimIdsStripped,
      truncated: out.claimIdsTruncated,
    }
  }

  it('keeps ids that exist in the ledger', () => {
    const r = run([{ ...base, claimIds: ['c1', 'c3'] }], ['c1', 'c2', 'c3'])
    expect(r.claimIds[0]).toEqual(['c1', 'c3'])
    expect(r.stripped).toBe(0)
  })

  it('strips ids missing from the ledger and counts them', () => {
    const r = run([{ ...base, claimIds: ['c1', 'c99', 'c100'] }], ['c1', 'c2'])
    expect(r.claimIds[0]).toEqual(['c1'])
    expect(r.stripped).toBe(2)
  })

  it('counts non-string entries as stripped', () => {
    const r = run([{ ...base, claimIds: ['c1', 42, null] }], ['c1'])
    expect(r.claimIds[0]).toEqual(['c1'])
    expect(r.stripped).toBe(2)
  })

  it('sums the strip count across sections', () => {
    const r = run([
      { ...base, claimIds: ['c1', 'nope'] },
      { ...base, claimIds: ['bad1', 'bad2'] },
    ], ['c1'])
    expect(r.claimIds).toEqual([['c1'], []])
    expect(r.stripped).toBe(3)
  })

  it('dedupes and caps at 8 without counting those as stripped', () => {
    // 去重與上限截斷是 schema 天花板、不是「ledger 裡沒有」——與未知 id 分開，
    // 否則 claimIdsStripped 就量不出「模型掛了幾個不存在的 claim」
    const valid = Array.from({ length: 10 }, (_, i) => `c${i + 1}`)
    const r = run([{ ...base, claimIds: [...valid, 'c1'] }], valid)
    expect(r.claimIds[0]).toEqual(valid.slice(0, 8))
    expect(r.stripped).toBe(0)
  })

  // 截斷不計入 stripped 是對的（那是幻覺率），但它**自己也要有一個數字**。
  // 2026-08-10 prod 實例：5 個 section 有 4 個掛滿 8 個上限，而 binding 的 unbound
  // 全部落在那些掛滿的 section——高度可疑是「模型想掛更多、被上限截掉」，
  // 但當時沒有任何 metric 看得到截斷，於是差額被算在模型頭上、無法判斷。
  it('counts ids dropped by the max-8 cap, separately from stripped', () => {
    const valid = Array.from({ length: 11 }, (_, i) => `c${i + 1}`)
    const r = run([{ ...base, claimIds: valid }], valid)
    expect(r.claimIds[0]).toHaveLength(8)
    expect(r.stripped).toBe(0)
    expect(r.truncated).toBe(3)
  })

  it('去重不計入 truncated（重複不代表模型想多掛）', () => {
    const r = run([{ ...base, claimIds: ['c1', 'c1', 'c2'] }], ['c1', 'c2'])
    expect(r.claimIds[0]).toEqual(['c1', 'c2'])
    expect(r.truncated).toBe(0)
  })

  it('未知 id 先被 strip，不會虛增 truncated', () => {
    // 9 個 id 但其中 3 個不在 ledger → 有效只剩 6 個、根本沒到上限
    const r = run([{ ...base, claimIds: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'x1', 'x2', 'x3'] }], ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'])
    expect(r.claimIds[0]).toHaveLength(6)
    expect(r.stripped).toBe(3)
    expect(r.truncated).toBe(0)
  })

  it('跨 section 累加 truncated', () => {
    const valid = Array.from({ length: 10 }, (_, i) => `c${i + 1}`)
    const r = run([
      { ...base, claimIds: valid },
      { ...base, claimIds: valid.slice(0, 9) },
    ], valid)
    expect(r.truncated).toBe(3)
  })

  it('leaves a section without claimIds untouched (schema default fills in [])', () => {
    const r = run([{ ...base }], ['c1'])
    expect(r.claimIds[0]).toBeUndefined()
    expect(r.stripped).toBe(0)
  })

  it('strips every id when the ledger is empty', () => {
    const r = run([{ ...base, claimIds: ['c1'] }], [])
    expect(r.claimIds[0]).toEqual([])
    expect(r.stripped).toBe(1)
  })

  it('reports 0 for a non-object raw', () => {
    expect(preNormalizeNarrativeRaw(null, { validUrls: [], validNewsIds: [], claimLedger: [] })).toEqual({
      narrative: null,
      claimIdsStripped: 0,
      claimCitationUrlsDropped: 0,
      sectionsWithClaimCitations: 0,
      claimIdsTruncated: 0,
    })
  })
})

// section 的 citationUrls 由它所用 claim 的 citation ref 反推。
// 三條路：① 有有效 citation ref → 由 ref 決定；② 沒有 citation ref（全 series 或無 claim）
// → 維持模型自己挑；③ 有 citation ref 但 url 不在 brief.citations → 視同 ②、計入 audit。
describe('preNormalizeNarrativeRaw citationUrls 反推', () => {
  const VALID_URLS = ['https://example.com/a', 'https://example.com/b', 'https://example.com/c', 'https://example.com/d']
  const base = { heading: '標題', body: '內文', relatedNewsIds: [] }

  function run(section: Record<string, unknown>, ledger: EvidenceClaim[]) {
    const out = preNormalizeNarrativeRaw(
      { intro: '導言。', sections: [section], outro: '結語。' },
      { validUrls: VALID_URLS, validNewsIds: ['n1'], claimLedger: ledger },
    )
    return {
      urls: (out.narrative as { sections: Array<{ citationUrls?: unknown }> }).sections[0]?.citationUrls,
      dropped: out.claimCitationUrlsDropped,
      fromClaims: out.sectionsWithClaimCitations,
    }
  }

  it('①由 claim 的 citation ref 決定，覆蓋模型自己挑的 url', () => {
    const r = run(
      { ...base, claimIds: ['c1', 'c2'], citationUrls: ['https://example.com/d'] },
      [claimOf('c1', ['https://example.com/a']), claimOf('c2', ['https://example.com/b'])],
    )
    expect(r.urls).toEqual(['https://example.com/a', 'https://example.com/b'])
    expect(r.fromClaims).toBe(1)
    expect(r.dropped).toBe(0)
  })

  it('①去重並取前 3', () => {
    const r = run(
      { ...base, claimIds: ['c1', 'c2', 'c3', 'c4'], citationUrls: ['https://example.com/d'] },
      [
        claimOf('c1', ['https://example.com/a']),
        claimOf('c2', ['https://example.com/a', 'https://example.com/b']),
        claimOf('c3', ['https://example.com/c']),
        claimOf('c4', ['https://example.com/d']),
      ],
    )
    expect(r.urls).toEqual(['https://example.com/a', 'https://example.com/b', 'https://example.com/c'])
  })

  it('②全是 series ref 時維持模型自己挑的 url', () => {
    const seriesClaim: EvidenceClaim = {
      ...claimOf('c1'),
      evidenceRefs: [{ kind: 'series', seriesId: 'us-sox', asOf: '2026-06-26' }],
    }
    const r = run({ ...base, claimIds: ['c1'], citationUrls: ['https://example.com/d'] }, [seriesClaim])
    expect(r.urls).toEqual(['https://example.com/d'])
    expect(r.fromClaims).toBe(0)
    expect(r.dropped).toBe(0)
  })

  it('②沒有 claimIds 的 section 完全走現行路徑', () => {
    const r = run({ ...base, citationUrls: ['https://example.com/d'] }, [claimOf('c1', ['https://example.com/a'])])
    expect(r.urls).toEqual(['https://example.com/d'])
    expect(r.fromClaims).toBe(0)
  })

  it('③claim 的 url 不在 brief.citations 時退回現行並計數，不靜默掛上不相干來源', () => {
    // 這是最危險的一條：反推出的無效 url 若落進 normalize 既有的空集 fallback，
    // 會被換成第一個 valid url——min(1) 過、superRefine 過、數字看起來正常，但出處是錯的
    const r = run(
      { ...base, claimIds: ['c1'], citationUrls: ['https://example.com/d'] },
      [claimOf('c1', ['https://evil.example.com/x'])],
    )
    expect(r.urls).toEqual(['https://example.com/d'])
    expect(r.fromClaims).toBe(0)
    expect(r.dropped).toBe(1)
  })

  it('③部分有效時只用有效的，被擋掉的仍計數', () => {
    const r = run(
      { ...base, claimIds: ['c1'], citationUrls: ['https://example.com/d'] },
      [claimOf('c1', ['https://example.com/a', 'https://evil.example.com/x'])],
    )
    expect(r.urls).toEqual(['https://example.com/a'])
    expect(r.fromClaims).toBe(1)
    expect(r.dropped).toBe(1)
  })

  it('反推結果為空且模型也沒挑對時，既有 fallback 仍保住 min(1)', () => {
    const r = run(
      { ...base, claimIds: ['c1'], citationUrls: ['https://unknown.example.com/z'] },
      [claimOf('c1', ['https://evil.example.com/x'])],
    )
    expect(r.urls).toEqual(['https://example.com/a'])
    expect(r.dropped).toBe(1)
  })

  it('被 strip 的 claimId 不參與反推（幻覺 id 不得決定出處）', () => {
    const r = run(
      { ...base, claimIds: ['c99'], citationUrls: ['https://example.com/d'] },
      [claimOf('c1', ['https://example.com/a'])],
    )
    expect(r.urls).toEqual(['https://example.com/d'])
    expect(r.fromClaims).toBe(0)
  })

  it('沒有 citationUrls 欄位時不憑空生一個（交給 Zod 判）', () => {
    const r = run({ ...base, claimIds: ['c1'] }, [claimOf('c1', ['https://example.com/a'])])
    expect(r.urls).toBeUndefined()
    expect(r.fromClaims).toBe(0)
  })
})
