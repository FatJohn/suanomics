import { FORBIDDEN_PHRASES } from '@suanomics/shared'
import { describe, expect, it } from 'vitest'
import { ITEM_CATEGORIES } from '../db/news-categories.js'
import { NEWS_CATEGORIZER_SYSTEM_PROMPT } from './news-categorizer.prompt.js'

describe('news-categorizer system prompt', () => {
  it('列出六類的英文 key', () => {
    for (const category of ITEM_CATEGORIES)
      expect(NEWS_CATEGORIZER_SYSTEM_PROMPT).toContain(category)
  })
  it('不再出現舊類別', () => {
    for (const old of ['tech-semi', 'tw-equity-other', 'international'])
      expect(NEWS_CATEGORIZER_SYSTEM_PROMPT).not.toContain(old)
  })
  it('帶入 shared 的 compliance 禁用語清單', () => {
    for (const phrase of FORBIDDEN_PHRASES)
      expect(NEWS_CATEGORIZER_SYSTEM_PROMPT).toContain(phrase)
  })
})
