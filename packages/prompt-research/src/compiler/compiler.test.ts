import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { MergedDraftSchema } from '../types.js'
import { compilePrompts, renderHeaderForAgentFile, renderSystemTsFile } from './compiler.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const draft = MergedDraftSchema.parse(JSON.parse(
  readFileSync(resolve(__dirname, '__fixtures__/sample-merged-draft.json'), 'utf-8'),
))

describe('compilePrompts', () => {
  it('should return 4 strings (shared, decomposer, analyst, synthesizer)', () => {
    const out = compilePrompts({ draft, runId: '2026-04-25-run' })
    expect(typeof out.shared).toBe('string')
    expect(typeof out.decomposer).toBe('string')
    expect(typeof out.analyst).toBe('string')
    expect(typeof out.synthesizer).toBe('string')
    expect(out.shared).toMatch(/Cascade/)
    expect(out.decomposer).toMatch(/Decomposer/)
    expect(out.analyst).toMatch(/Analyst/)
    expect(out.synthesizer).toMatch(/Synthesizer/)
  })

  it('should embed shared preamble in each agent prompt', () => {
    const out = compilePrompts({ draft, runId: 'r' })
    expect(out.decomposer.startsWith(out.shared)).toBe(true)
    expect(out.analyst.startsWith(out.shared)).toBe(true)
    expect(out.synthesizer.startsWith(out.shared)).toBe(true)
  })

  it('should NOT include L3 compliance in shared / decomposer / analyst', () => {
    const out = compilePrompts({ draft, runId: 'r' })
    expect(out.shared).not.toContain('44 條')
    expect(out.decomposer).not.toContain('44 條')
    expect(out.analyst).not.toContain('44 條')
  })

  it('should include L3 compliance in synthesizer only', () => {
    const out = compilePrompts({ draft, runId: 'r' })
    expect(out.synthesizer).toContain('44 條')
  })
})

describe('renderHeaderForAgentFile', () => {
  it('should include AUTO-GENERATED warning + DO NOT EDIT', () => {
    const h = renderHeaderForAgentFile({
      runId: 'r1',
      generatedAt: '2026-04-25T00:00:00Z',
      sources: [{ slug: 's1', refUrl: 'https://x' }],
    })
    expect(h).toMatch(/AUTO-GENERATED/i)
    expect(h).toMatch(/DO NOT EDIT/i)
    expect(h).toContain('regenerate via prompt:compile; 人工取捨在 promote 時進行')
  })

  it('should list source slugs + URLs', () => {
    const h = renderHeaderForAgentFile({
      runId: 'r1',
      generatedAt: '2026-04-25T00:00:00Z',
      sources: [
        { slug: 'source-a', refUrl: 'https://github.com/a' },
        { slug: 'source-b' }, // no refUrl
      ],
    })
    expect(h).toContain('source-a')
    expect(h).toContain('https://github.com/a')
    expect(h).toContain('source-b')
  })

  it('should include runId', () => {
    const h = renderHeaderForAgentFile({
      runId: '2026-04-25-run-abc',
      generatedAt: '2026-04-25T00:00:00Z',
      sources: [],
    })
    expect(h).toContain('2026-04-25-run-abc')
  })
})

describe('renderSystemTsFile', () => {
  it('should produce valid TS export const with backtick string', () => {
    const out = renderSystemTsFile({
      exportName: 'TEST_PROMPT',
      promptBody: 'hello world',
      header: '// HEADER',
    })
    expect(out).toContain('// HEADER')
    expect(out).toContain('export const TEST_PROMPT = `hello world`')
  })

  it('should escape backticks in body', () => {
    const out = renderSystemTsFile({
      exportName: 'X',
      promptBody: 'use `code` here',
      header: '// h',
    })
    expect(out).toContain('use \\`code\\` here')
  })

  it('should escape ${} interpolation', () => {
    const out = renderSystemTsFile({
      exportName: 'X',
      // eslint-disable-next-line no-template-curly-in-string -- intentional: testing escaping of ${} in prompt body
      promptBody: 'price: ${price}',
      header: '// h',
    })
    // eslint-disable-next-line no-template-curly-in-string -- intentional: verifying escaped output contains literal ${price}
    expect(out).toContain('price: \\${price}')
  })

  it('should include imports if provided', () => {
    const out = renderSystemTsFile({
      exportName: 'X',
      promptBody: 'body',
      header: '// h',
      imports: ['{ SHARED_PREAMBLE } from \'./_shared.system.js\''],
    })
    expect(out).toMatch(/import \{ SHARED_PREAMBLE \} from '.\/_shared\.system\.js'/)
  })
})
