import { describe, expect, it } from 'vitest'
import { ANALYST_TIER1_SYSTEM_PROMPT } from './analyst-tier1.prompt.js'

describe('時間框架節', () => {
  it('含時間框架 + 禁止照抄 + 昨日', () => {
    expect(ANALYST_TIER1_SYSTEM_PROMPT).toContain('時間框架')
    expect(ANALYST_TIER1_SYSTEM_PROMPT).toContain('禁止照抄')
    expect(ANALYST_TIER1_SYSTEM_PROMPT).toContain('昨日')
  })

  it('含台股對照表規則 + 其他市場用發布時間', () => {
    expect(ANALYST_TIER1_SYSTEM_PROMPT).toContain('對照表')
    expect(ANALYST_TIER1_SYSTEM_PROMPT).toContain('台股')
    expect(ANALYST_TIER1_SYSTEM_PROMPT).toContain('發布時間')
  })
})

describe('analyst tier1 system prompt macro frames wiring', () => {
  it('includes the macro interpretation section header', () => {
    expect(ANALYST_TIER1_SYSTEM_PROMPT).toContain('## 總經數據解讀框架')
  })

  it('allows citing the primary news url, not only retrieve results', () => {
    expect(ANALYST_TIER1_SYSTEM_PROMPT).toContain('主新聞或上游 retrieve')
  })

  it('includes the core 3 macro frame names', () => {
    expect(ANALYST_TIER1_SYSTEM_PROMPT).toContain('通膨統計分類拆解')
    expect(ANALYST_TIER1_SYSTEM_PROMPT).toContain('油價供需結構')
    expect(ANALYST_TIER1_SYSTEM_PROMPT).toContain('央行房市口風與政策利率傳導')
  })

  it('still includes the distilled prompt content head and tail (not clobbered)', () => {
    expect(ANALYST_TIER1_SYSTEM_PROMPT).toContain('Cascade（連動）') // head
    // tail：distilled body 最後一段 section heading；確保整段 body 沒被截斷
    expect(ANALYST_TIER1_SYSTEM_PROMPT).toContain(
      '# 合規鐵線（明文禁用詞、絕對不可出現在 mechanism / industry 任何欄位）',
    )
  })

  it('appends the macro section after the distilled body', () => {
    const distilledIdx = ANALYST_TIER1_SYSTEM_PROMPT.indexOf('Cascade（連動）')
    const macroIdx = ANALYST_TIER1_SYSTEM_PROMPT.indexOf('## 總經數據解讀框架')
    expect(distilledIdx).toBeGreaterThanOrEqual(0)
    expect(macroIdx).toBeGreaterThan(distilledIdx)
  })
})
