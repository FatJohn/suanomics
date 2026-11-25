import { describe, expect, it } from 'vitest'
import { CLAIMS_PROMPT_SECTION, renderCitableSeriesSection } from './analyst-claims.js'

// Characterization test：凍結 CLAIMS_PROMPT_SECTION 與 renderCitableSeriesSection
// 每個分支的輸出，供後續把可引用序列標題句與 claim 契約說明搬進 prompts/ 之後比對逐字未變。
describe('analyst-claims user content snapshot', () => {
  it('claim 契約指示文字（CLAIMS_PROMPT_SECTION）', () => {
    expect(CLAIMS_PROMPT_SECTION).toMatchSnapshot()
  })

  it('renderCitableSeriesSection：非空清單', () => {
    const lines: string[] = []
    renderCitableSeriesSection(lines, [
      { seriesId: 'us-sox', displayName: '費城半導體指數', asOf: '2026-08-04' },
      { seriesId: 'taiex-close', displayName: '加權指數', asOf: '2026-08-05' },
    ])
    expect(lines.join('\n')).toMatchSnapshot()
  })

  it('renderCitableSeriesSection：空清單（整段不出現）', () => {
    const lines: string[] = []
    renderCitableSeriesSection(lines, [])
    expect(lines).toEqual([])
  })

  it('renderCitableSeriesSection：接在既有內容之後（驗證前導空行）', () => {
    const lines: string[] = ['# 既有內容', '一些文字']
    renderCitableSeriesSection(lines, [
      { seriesId: 'us-cpi-yoy', displayName: 'CPI 年增率', asOf: '2026-05-01' },
    ])
    expect(lines.join('\n')).toMatchSnapshot()
  })
})
