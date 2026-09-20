import { describe, expect, it } from 'vitest'
import { EDITOR_SYSTEM_PROMPT } from './editor.prompt.js'

describe('editor system prompt', () => {
  it('砍掉 macro-first bias 字眼', () => {
    expect(EDITOR_SYSTEM_PROMPT).not.toContain('優先於新鮮度')
    expect(EDITOR_SYSTEM_PROMPT).not.toContain('總經影響面）優先')
  })

  it('含平衡選題 + 當日重點指示', () => {
    expect(EDITOR_SYSTEM_PROMPT).toContain('平衡')
    expect(EDITOR_SYSTEM_PROMPT).toContain('當日真正重點')
  })

  it('保留只能選候選 id 的防呆紀律', () => {
    expect(EDITOR_SYSTEM_PROMPT).toContain('不可虛構')
  })
})

describe('editor system prompt 5-way balance', () => {
  it('lists all 5 item category labels', () => {
    for (const label of ['科技半導體', '台股其他', '總經', '能源', '國際'])
      expect(EDITOR_SYSTEM_PROMPT).toContain(label)
  })
})

describe('editor system prompt 降半導體 over-rotation', () => {
  it('拔掉半導體預設優先字眼', () => {
    expect(EDITOR_SYSTEM_PROMPT).not.toContain('科技半導體對台灣投資人影響最直接、優先')
  })

  it('加入抗 over-rotation 與廣度指引', () => {
    expect(EDITOR_SYSTEM_PROMPT).toContain('勿因排序靠前就過度選半導體')
    expect(EDITOR_SYSTEM_PROMPT).toContain('不獨佔多數')
  })
})

describe('editor system prompt 職責3 valence + delta + resolve', () => {
  it('instructs valence discrimination, delta notes, and rare resolve', () => {
    expect(EDITOR_SYSTEM_PROMPT).toContain('support')
    expect(EDITOR_SYSTEM_PROMPT).toContain('challenge')
    expect(EDITOR_SYSTEM_PROMPT).toContain('extend')
    expect(EDITOR_SYSTEM_PROMPT).toContain('resolveStorylines')
    expect(EDITOR_SYSTEM_PROMPT).toMatch(/相對|新增|改變/) // delta 指令
  })
})

describe('editor system prompt dailyThesis', () => {
  it('指示產出可辯論的單句本日論點 thesis', () => {
    expect(EDITOR_SYSTEM_PROMPT).toContain('dailyThesis')
    expect(EDITOR_SYSTEM_PROMPT).toContain('可辯論')
  })
  it('保留 mainThemes 作為服務 thesis 的子角度', () => {
    expect(EDITOR_SYSTEM_PROMPT).toContain('mainThemes')
    expect(EDITOR_SYSTEM_PROMPT).toContain('當日真正重點')
    expect(EDITOR_SYSTEM_PROMPT).toContain('服務')
    expect(EDITOR_SYSTEM_PROMPT).toContain('子角度')
  })
})
