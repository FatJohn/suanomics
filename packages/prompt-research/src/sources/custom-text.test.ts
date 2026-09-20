import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readCustomText } from './custom-text.js'

describe('readCustomText', () => {
  it('reads a local file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'prompt-research-'))
    const p = join(dir, 'notes.md')
    writeFileSync(p, '# Hello', 'utf8')
    const result = readCustomText({ filePath: p })
    expect(result.content).toBe('# Hello')
    expect(result.localPath).toBe(p)
  })

  it('throws on missing file', () => {
    expect(() => readCustomText({ filePath: '/nonexistent-xyz.md' })).toThrow()
  })
})
