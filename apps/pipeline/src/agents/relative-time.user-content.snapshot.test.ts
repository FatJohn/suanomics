import { describe, expect, it } from 'vitest'
import { relativeDayLabel } from './relative-time.js'

// Characterization test：凍結 relativeDayLabel 每個分支的輸出，供後續把
// 「今日／昨日／前日／N天前」搬進 prompts/ 之後比對逐字未變。
describe('relative-time user content snapshot', () => {
  it('今日', () => {
    expect(relativeDayLabel('2026-06-27T00:00:00Z', '2026-06-27')).toMatchSnapshot()
  })

  it('昨日', () => {
    expect(relativeDayLabel('2026-06-26T06:37:02Z', '2026-06-27')).toMatchSnapshot()
  })

  it('前日', () => {
    expect(relativeDayLabel('2026-06-25T06:00:00Z', '2026-06-27')).toMatchSnapshot()
  })

  it('超過兩日 → N天前', () => {
    expect(relativeDayLabel('2026-06-22T06:00:00Z', '2026-06-27')).toMatchSnapshot()
  })

  it('空字串（null / 非法 iso / 晚於報告日）', () => {
    expect(relativeDayLabel(null, '2026-06-27')).toMatchSnapshot()
    expect(relativeDayLabel('not-a-date', '2026-06-27')).toMatchSnapshot()
    expect(relativeDayLabel('2026-06-28T06:00:00Z', '2026-06-27')).toMatchSnapshot()
  })
})
