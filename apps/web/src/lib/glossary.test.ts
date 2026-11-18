import type { GlossaryEntry } from './glossary'
import { describe, expect, it } from 'vitest'
import { annotateHtml, escapeHtml, findTerms } from './glossary'

const entries: GlossaryEntry[] = [
  { id: 'real-rate', term: '實質利率', aliases: [], definition: '扣掉通膨後的利率。' },
  { id: 'sox', term: '費半', aliases: ['費城半導體指數'], definition: '美國半導體股的指數。' },
  { id: 'cpi', term: 'CPI', aliases: [], definition: '消費者物價指數。' },
  { id: 'core-cpi', term: '核心 CPI', aliases: [], definition: '扣掉食物與能源的 CPI。' },
]

describe('findTerms', () => {
  it('沒有術語時整段原樣回傳', () => {
    expect(findTerms('油價持平。', entries, new Set())).toEqual([{ text: '油價持平。' }])
  })

  it('標出術語並保留前後文字', () => {
    expect(findTerms('今天實質利率上行。', entries, new Set())).toEqual([
      { text: '今天' },
      { text: '實質利率', entry: entries[0] },
      { text: '上行。' },
    ])
  })

  it('同一個術語只標第一次出現', () => {
    const segments = findTerms('實質利率與實質利率', entries, new Set())
    expect(segments.filter(s => s.entry)).toHaveLength(1)
    expect(segments.map(s => s.text).join('')).toBe('實質利率與實質利率')
  })

  it('已經在 seen 裡的術語不再標，並把新標的術語記進 seen', () => {
    const seen = new Set(['real-rate'])
    const segments = findTerms('實質利率與費半', entries, seen)
    expect(segments.filter(s => s.entry).map(s => s.entry?.id)).toEqual(['sox'])
    expect([...seen].sort()).toEqual(['real-rate', 'sox'])
  })

  it('別名也算同一個術語，標了別名後本名不再標', () => {
    const segments = findTerms('費城半導體指數上漲，費半創高', entries, new Set())
    expect(segments.filter(s => s.entry)).toEqual([{ text: '費城半導體指數', entry: entries[1] }])
  })

  it('同一位置有多個術語可比對時取最長的', () => {
    const segments = findTerms('核心 CPI 2.57%', entries, new Set())
    expect(segments[0]).toEqual({ text: '核心 CPI', entry: entries[3] })
  })

  it('較短的術語是較長術語的開頭時，不論詞庫順序都取較長的', () => {
    const prefixed: GlossaryEntry[] = [
      { id: 'short', term: '融券', aliases: [], definition: 'a' },
      { id: 'long', term: '融券餘額', aliases: [], definition: 'b' },
    ]
    expect(findTerms('融券餘額降', prefixed, new Set())[0]?.text).toBe('融券餘額')
    expect(findTerms('融券餘額降', [...prefixed].reverse(), new Set())[0]?.text).toBe('融券餘額')
  })

  it('英文術語不比對到更長英文字的一部分', () => {
    expect(findTerms('CPIX 與 ACPI', entries, new Set()).some(s => s.entry)).toBe(false)
    expect(findTerms('美國CPI年增', entries, new Set()).some(s => s.entry)).toBe(true)
  })

  it('中英混合的術語只檢查英文那一端的邊界', () => {
    const mixed: GlossaryEntry[] = [{ id: 'ffr', term: 'Fed funds 利率', aliases: [], definition: 'a' }]
    expect(findTerms('Fed funds 利率3.88%', mixed, new Set())[0]?.text).toBe('Fed funds 利率')
    expect(findTerms('XFed funds 利率', mixed, new Set()).some(s => s.entry)).toBe(false)
  })
})

describe('escapeHtml', () => {
  it('跳脫 HTML 特殊字元', () => {
    expect(escapeHtml(`<a href="x">&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;')
  })
})

describe('annotateHtml', () => {
  it('把術語換成點開按鈕與解釋 popover', () => {
    expect(annotateHtml('<p>實質利率上行</p>', entries, new Set())).toBe(
      '<p><button type="button" class="term" popovertarget="term-real-rate">實質利率</button>'
      + '<span class="gloss" id="term-real-rate" popover><strong>實質利率</strong>扣掉通膨後的利率。</span>上行</p>',
    )
  })

  it('不改動標籤裡的文字', () => {
    const html = '<p title="實質利率">x</p>'
    expect(annotateHtml(html, entries, new Set())).toBe(html)
  })

  it('跨段落共用 seen：後面的段落不重複標', () => {
    const out = annotateHtml('<p>CPI</p><p><em>CPI</em></p>', entries, new Set())
    expect(out.match(/<button/g)).toHaveLength(1)
    expect(out.endsWith('<p><em>CPI</em></p>')).toBe(true)
  })

  it('解釋文字做 HTML 跳脫', () => {
    const risky: GlossaryEntry[] = [{ id: 'x', term: '利差', aliases: [], definition: 'a<b>&' }]
    expect(annotateHtml('利差', risky, new Set())).toContain('利差</strong>a&lt;b&gt;&amp;</span>')
  })
})
