import { describe, expect, it } from 'vitest'
import { COMPLIANCE_REWRITE_MAP } from './narrative-shared.js'

// Characterization test：釘住整份投信投顧法合規改寫詞對表（順序即套用順序），在把資料搬到
// prompts/narrative-shared.user-content.ts 之前先凍結行為基線。既有 narrative-shared.test.ts
// 只斷言個別幾組改寫結果，這裡逐項 snapshot 整份表、確保順序與內容一個字都沒有跑掉。
describe('cOMPLIANCE_REWRITE_MAP — characterization baseline', () => {
  it('pins every [from, to] pair, in order', () => {
    expect(COMPLIANCE_REWRITE_MAP).toMatchSnapshot()
  })
})
