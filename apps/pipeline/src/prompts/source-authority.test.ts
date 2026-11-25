import { containsForbiddenPhrase, FORBIDDEN_PHRASES } from '@suanomics/shared'
import { describe, expect, it } from 'vitest'
import { ANALYST_TIER1_SYSTEM_PROMPT } from './analyst-tier1.prompt.js'
import { ANALYST_TIER2_SYSTEM_PROMPT } from './analyst-tier2.prompt.js'
import { NARRATIVE_WRITER_SYSTEM_PROMPT, NARRATIVE_WRITER_WEEKEND_SYSTEM_PROMPT } from './narrative-writer.prompt.js'
import { FORBIDDEN_PHRASES_LINE, SOURCE_AUTHORITY_SECTION } from './source-authority.js'
import { SYNTHESIZER_SYSTEM_PROMPT } from './synthesizer.prompt.js'

// 會把文章素材寫成論據的 agent（#111）。
const ARGUMENT_PROMPTS = {
  'analyst-tier1': ANALYST_TIER1_SYSTEM_PROMPT,
  'analyst-tier2': ANALYST_TIER2_SYSTEM_PROMPT,
  'synthesizer': SYNTHESIZER_SYSTEM_PROMPT,
  'narrative-writer': NARRATIVE_WRITER_SYSTEM_PROMPT,
  'narrative-writer-weekend': NARRATIVE_WRITER_WEEKEND_SYSTEM_PROMPT,
}

describe('論據來源紀律段', () => {
  it('列出可引用的權責發言來源', () => {
    for (const source of ['央行', '主管機關', '公司經營層', '研究機構'])
      expect(SOURCE_AUTHORITY_SECTION).toContain(source)
  })

  it('排除政治人物與名嘴的評論', () => {
    expect(SOURCE_AUTHORITY_SECTION).toContain('政治人物')
    expect(SOURCE_AUTHORITY_SECTION).toContain('名嘴')
  })

  it('市場素材不在排除之列', () => {
    for (const source of ['法人', '券商', '分析師'])
      expect(SOURCE_AUTHORITY_SECTION).toContain(source)
  })

  it('評論本身造成行情波動時只當事件描述', () => {
    expect(SOURCE_AUTHORITY_SECTION).toContain('市場反應')
  })

  it('素材扣掉評論後不足時寧可少寫、不用內建知識補', () => {
    expect(SOURCE_AUTHORITY_SECTION).toContain('寧可少寫')
    expect(SOURCE_AUTHORITY_SECTION).toContain('內建知識')
  })

  it('檢索到的文章也適用', () => {
    expect(SOURCE_AUTHORITY_SECTION).toContain('檢索到的文章')
  })

  it('本身不含禁用語', () => {
    expect(containsForbiddenPhrase(SOURCE_AUTHORITY_SECTION).hit).toBe(false)
  })
})

describe.each(Object.entries(ARGUMENT_PROMPTS))('%s system prompt', (_name, prompt) => {
  it('帶入論據來源紀律段', () => {
    expect(prompt).toContain(SOURCE_AUTHORITY_SECTION)
  })

  it('帶入 shared 的 compliance 禁用語清單', () => {
    for (const phrase of FORBIDDEN_PHRASES)
      expect(prompt).toContain(phrase)
  })

  // 禁用語只在 shared 清單那一行出現：prompt 不另抄一份清單，也不拿禁用語（含異體字）當範例語氣，
  // 不然 shared 清單更新時抄本不會跟著變，模型也會照範例寫。
  it('只在 shared 清單那一行出現禁用語', () => {
    const outsideList = prompt.replaceAll(FORBIDDEN_PHRASES_LINE, '')
    expect(prompt).toContain(FORBIDDEN_PHRASES_LINE)
    expect(containsForbiddenPhrase(outsideList).hit).toBe(false)
    expect(outsideList).not.toContain('布局')
  })
})
