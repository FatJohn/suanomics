import { checkCompliance } from '@suanomics/shared'
import { describe, expect, it } from 'vitest'
import { redactBlockedSentences } from './compliance'
import { GLOSSARY } from './glossary-terms'

// 解釋是一小段插在句子裡的 popover，太長在手機上要捲動才讀得完。
const MAX_DEFINITION_CHARS = 90

describe('glossary 詞庫', () => {
  it('每條解釋都通過 compliance：pipeline 的判定與網站的刪句都不動它', () => {
    for (const { term, definition } of GLOSSARY) {
      expect(checkCompliance(definition), term).toBeNull()
      expect(redactBlockedSentences(definition), term).toBe(definition)
    }
  })

  it('術語名稱與解釋接在一起讀也通過 compliance', () => {
    for (const { term, definition } of GLOSSARY)
      expect(checkCompliance(`${term}${definition}`), term).toBeNull()
  })

  it('id 不重複，且只用小寫英數與連字號（會放進 HTML id）', () => {
    const ids = GLOSSARY.map(e => e.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids)
      expect(id).toMatch(/^[a-z0-9-]+$/)
  })

  it('同一個寫法不會同時屬於兩個術語', () => {
    const forms = GLOSSARY.flatMap(e => [e.term, ...e.aliases])
    expect(new Set(forms).size).toBe(forms.length)
  })

  it('每條解釋非空、以句號結尾、不超過長度上限', () => {
    for (const { term, definition } of GLOSSARY) {
      expect(definition.length, term).toBeGreaterThan(0)
      expect(definition.length, term).toBeLessThanOrEqual(MAX_DEFINITION_CHARS)
      expect(definition.endsWith('。'), term).toBe(true)
    }
  })
})
