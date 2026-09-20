import { describe, expect, it } from 'vitest'
import { sectionDomId, sectionLabel } from './narrative-nav.js'

describe('sectionDomId', () => {
  it('shouldBuildStableAnchorId', () => {
    expect(sectionDomId(0)).toBe('narrative-sec-0')
    expect(sectionDomId(2)).toBe('narrative-sec-2')
  })
})

describe('sectionLabel', () => {
  it('shouldReturnHeadingWhenPresent', () => {
    expect(sectionLabel('利率與通膨', 'body text', 0)).toBe('利率與通膨')
  })

  it('shouldTrimHeadingBeforeUsing', () => {
    expect(sectionLabel('  利率與通膨  ', 'body text', 0)).toBe('利率與通膨')
  })

  it('shouldFallBackToBodySnippetWhenHeadingNull', () => {
    const body = '聯準會本週宣布維持利率不變、市場解讀為偏鴿、後續仍須觀察通膨數據走勢'
    const label = sectionLabel(null, body, 0)
    // 取首行 ~16 字、超長時尾接 …、整體長度 ≤ 17
    expect(label.endsWith('…')).toBe(true)
    expect(label.length).toBeLessThanOrEqual(17)
    expect(body.startsWith(label.slice(0, -1))).toBe(true)
  })

  it('shouldFallBackToBodySnippetWhenHeadingEmpty', () => {
    const body = '聯準會本週宣布維持利率不變、市場解讀為偏鴿、後續仍須觀察通膨數據走勢'
    expect(sectionLabel('   ', body, 0)).toBe(sectionLabel(null, body, 0))
  })

  it('shouldNotAppendEllipsisWhenBodyShort', () => {
    expect(sectionLabel(null, '短句', 0)).toBe('短句')
  })

  it('shouldStripLeadingMarkdownMarkers', () => {
    expect(sectionLabel(null, '## 重點摘要', 0)).toBe('重點摘要')
  })

  it('shouldUseOnlyFirstLineOfBody', () => {
    expect(sectionLabel(null, '第一行\n第二行內容', 0)).toBe('第一行')
  })

  it('shouldReturnOrdinalLabelWhenBodyEmpty', () => {
    expect(sectionLabel(null, '', 0)).toBe('第 1 段')
    expect(sectionLabel(undefined, '   ', 4)).toBe('第 5 段')
  })
})
