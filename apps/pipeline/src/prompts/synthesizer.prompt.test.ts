import { TWSE_LISTED_INDUSTRIES } from '@suanomics/shared'
import { describe, expect, it } from 'vitest'
import { SYNTHESIZER_SYSTEM_PROMPT } from './synthesizer.prompt.js'

describe('synthesizer system prompt', () => {
  it('lists every TWSE listed industry as the only allowed affectedIndustries names', () => {
    expect(SYNTHESIZER_SYSTEM_PROMPT).toContain('affectedIndustries')
    for (const name of TWSE_LISTED_INDUSTRIES)
      expect(SYNTHESIZER_SYSTEM_PROMPT).toContain(name)
  })
})
