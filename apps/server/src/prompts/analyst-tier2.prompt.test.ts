import { describe, expect, it } from 'vitest'
import { ANALYST_TIER2_SYSTEM_PROMPT } from './analyst-tier2.prompt.js'

describe('aNALYST_TIER2_SYSTEM_PROMPT', () => {
  it('exports a non-trivial prompt string', () => {
    expect(typeof ANALYST_TIER2_SYSTEM_PROMPT).toBe('string')
    expect(ANALYST_TIER2_SYSTEM_PROMPT.length).toBeGreaterThan(200)
  })
  it('explicitly forbids nextTierEntities output', () => {
    expect(ANALYST_TIER2_SYSTEM_PROMPT).toContain('nextTierEntities')
    expect(ANALYST_TIER2_SYSTEM_PROMPT).toMatch(/不要|禁/)
  })
  it('requires mechanism to reference tier 1', () => {
    expect(ANALYST_TIER2_SYSTEM_PROMPT).toMatch(/tier 1|reference|引用/)
  })
})
