import { describe, expect, it } from 'vitest'
import { appendMarketSnapshotSection, READER_SNAPSHOT_HEADING } from './market-snapshot-section.js'

// Characterization test：凍結 READER_SNAPSHOT_HEADING 與 appendMarketSnapshotSection
// 每個分支的輸出，供後續把標題與規則句搬進 prompts/ 之後比對逐字未變。
describe('market-snapshot-section user content snapshot', () => {
  it('讀者面標題文字（READER_SNAPSHOT_HEADING）', () => {
    expect(READER_SNAPSHOT_HEADING).toMatchSnapshot()
  })

  it('appendMarketSnapshotSection：有快照時附加完整區塊', () => {
    const lines: string[] = ['# 既有內容']
    appendMarketSnapshotSection(lines, '- 台股加權指數：22,345 點（+1.2%）\n- 美元兌台幣：31.5')
    expect(lines.join('\n')).toMatchSnapshot()
  })

  it('appendMarketSnapshotSection：marketSnapshot 為 null → 不附加', () => {
    const lines: string[] = ['# 既有內容']
    appendMarketSnapshotSection(lines, null)
    expect(lines).toEqual(['# 既有內容'])
  })

  it('appendMarketSnapshotSection：marketSnapshot 為 undefined → 不附加', () => {
    const lines: string[] = ['# 既有內容']
    appendMarketSnapshotSection(lines, undefined)
    expect(lines).toEqual(['# 既有內容'])
  })

  it('appendMarketSnapshotSection：marketSnapshot 為空字串 → 不附加', () => {
    const lines: string[] = ['# 既有內容']
    appendMarketSnapshotSection(lines, '')
    expect(lines).toEqual(['# 既有內容'])
  })
})
