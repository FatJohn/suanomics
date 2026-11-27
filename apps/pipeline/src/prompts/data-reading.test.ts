import { describe, expect, it } from 'vitest'
import { ANALYST_TIER1_SYSTEM_PROMPT } from './analyst-tier1.prompt.js'
import { ANALYST_TIER2_SYSTEM_PROMPT } from './analyst-tier2.prompt.js'
import { NARRATIVE_WRITER_SYSTEM_PROMPT, NARRATIVE_WRITER_WEEKEND_SYSTEM_PROMPT } from './narrative-writer.prompt.js'
import { PODCAST_WRITER_SYSTEM_PROMPT } from './podcast-writer.prompt.js'
import { SYNTHESIZER_SYSTEM_PROMPT } from './synthesizer.prompt.js'
import { NET_READ_PROMPT, RISK_PROMPT, SUPPORT_PROMPT } from './viewpoints-debate.prompt.js'

// #122：會把快照數字寫成因果句或利率判讀的 agent 都要帶這兩條規則。
const PROMPTS = [
  ['analyst-tier1', ANALYST_TIER1_SYSTEM_PROMPT],
  ['analyst-tier2', ANALYST_TIER2_SYSTEM_PROMPT],
  ['synthesizer', SYNTHESIZER_SYSTEM_PROMPT],
  ['narrative', NARRATIVE_WRITER_SYSTEM_PROMPT],
  ['narrative-weekend', NARRATIVE_WRITER_WEEKEND_SYSTEM_PROMPT],
  ['support', SUPPORT_PROMPT],
  ['risk', RISK_PROMPT],
  ['net-read', NET_READ_PROMPT],
  ['podcast', PODCAST_WRITER_SYSTEM_PROMPT],
] as const

describe('資料日一致（#113 G5）', () => {
  it.each(PROMPTS)('%s 要求同一個因果句只用同一資料日的數字，或寫明各自的資料日', (_, prompt) => {
    expect(prompt).toContain('同一個因果句只放同一資料日的數字')
    expect(prompt).toContain('逐一寫出各自的資料日')
  })

  // 各 agent 的快照段落標題不同（市場數據參考／市場數據快照／市場數據），規則不能只點其中一個名字。
  it.each(PROMPTS)('%s 的規則涵蓋各種快照段落標題', (_, prompt) => {
    expect(prompt).toContain('「市場數據參考」「市場數據快照」「市場數據」')
  })

  it.each(PROMPTS)('%s 禁止用「同期」連起不同資料日的數字', (_, prompt) => {
    expect(prompt).toContain('不得用「同期」「同日」「同時」「當天」')
  })
})

describe('利率路徑方向（#113 G3）', () => {
  it.each(PROMPTS)('%s 要求先講市場定價的下一步方向', (_, prompt) => {
    expect(prompt).toContain('先講市場定價的下一步是升息、降息還是按兵不動')
  })

  it.each(PROMPTS)('%s 要求依 2 年期殖利率與政策利率的利差判讀方向', (_, prompt) => {
    expect(prompt).toContain('美債 2 年期殖利率高於 Fed funds 利率')
    expect(prompt).toContain('代表市場預期政策利率上升')
    expect(prompt).toContain('比 Fed funds 利率低 0.25 個百分點以上')
    expect(prompt).toContain('不得沿用降息框架')
  })

  // Fed funds 是月資料，決議後最多落後約六週；用舊值算利差會判反方向。
  it.each(PROMPTS)('%s 在 Fed funds 早於最近一次利率決議時改用決議後的政策利率', (_, prompt) => {
    expect(prompt).toContain('Fed funds 利率是月資料')
    expect(prompt).toContain('以決議後的政策利率為準')
  })
})
