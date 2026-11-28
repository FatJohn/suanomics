import type { GlossaryEntry } from './glossary'
import type { BriefView } from './present-brief'
import { describe, expect, it } from 'vitest'
import { briefHtml } from './brief-html'

const glossary: GlossaryEntry[] = [
  { id: 'real-rate', term: '實質利率', aliases: [], definition: '扣掉通膨後的利率。' },
]

function brief(overrides: Partial<BriefView> = {}): BriefView {
  return {
    date: '2026-11-27',
    headline: '標題',
    dailyThesis: '實質利率上行壓住估值。',
    summary: '摘要',
    narrative: { intro: '導讀提到實質利率。', sections: [{ heading: '小標', takeaway: '', body: '本文再提實質利率。', citations: [] }], outro: '' },
    viewpoints: null,
    industries: [],
    selectedNews: [],
    citations: [],
    disclaimer: '本分析僅供參考',
    audioUrl: null,
    ...overrides,
  }
}

describe('briefHtml', () => {
  it('主軸不標術語，術語改在導讀第一次出現處標', () => {
    const html = briefHtml(brief(), glossary)
    expect(html.thesisHtml).not.toContain('class="term"')
    expect(html.introHtml).toContain('popovertarget="term-real-rate"')
    expect(html.bodyHtml[0]).not.toContain('class="term"')
  })

  it('沒有導讀時，術語在詳解本文第一次出現處標', () => {
    const html = briefHtml(brief({ narrative: { intro: '', sections: [{ heading: '小標', takeaway: '', body: '本文提實質利率。', citations: [] }], outro: '' } }), glossary)
    expect(html.thesisHtml).not.toContain('class="term"')
    expect(html.bodyHtml[0]).toContain('popovertarget="term-real-rate"')
  })

  it('主軸仍做 HTML 跳脫', () => {
    expect(briefHtml(brief({ dailyThesis: '<b>實質利率</b>' }), glossary).thesisHtml).toBe('&lt;b&gt;實質利率&lt;/b&gt;')
  })
})
