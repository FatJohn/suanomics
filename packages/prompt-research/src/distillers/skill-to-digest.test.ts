import { describe, expect, it } from 'vitest'
import { buildSkillDistillSystemPrompt } from './skill-to-digest.js'

describe('buildSkillDistillSystemPrompt', () => {
  it('includes the phrase "分析框架提煉器"', () => {
    const p = buildSkillDistillSystemPrompt()
    expect(p).toContain('分析框架提煉器')
  })

  it('includes 合規紅線 from @suanomics/shared FORBIDDEN_PHRASES', () => {
    const p = buildSkillDistillSystemPrompt()
    expect(p).toMatch(/禁用詞/)
  })

  it('instructs frames are per-news-event, not per-company', () => {
    const p = buildSkillDistillSystemPrompt()
    expect(p).toContain('新聞事件')
  })
})
