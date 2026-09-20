import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runCompile } from './cli-compile.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// 使用和 compiler.test.ts 相同的 fixture
const FIXTURES_DIR = resolve(__dirname, '__fixtures__')

let tmpDir: string
let tmpOutputsDir: string
let tmpPromptsDir: string

beforeAll(async () => {
  tmpDir = resolve(tmpdir(), `cli-compile-test-${Date.now()}`)
  tmpOutputsDir = resolve(tmpDir, 'outputs')
  tmpPromptsDir = resolve(tmpDir, 'prompts', 'test-run')

  const runId = 'test-run'
  const runOutputsDir = resolve(tmpOutputsDir, runId)
  await mkdir(runOutputsDir, { recursive: true })

  // 複製 sample-merged-draft.json 到 outputs/<runId>/
  const draftJson = await readFile(resolve(FIXTURES_DIR, 'sample-merged-draft.json'), 'utf-8')
  await writeFile(
    resolve(runOutputsDir, 'merged-analyzer-prompt-draft.json'),
    draftJson,
    'utf-8',
  )
})

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

describe('runCompile', () => {
  it('returns writtenPaths array matching files actually written', async () => {
    const result = await runCompile({
      runId: 'test-run',
      outputsDir: tmpOutputsDir,
      promptsDir: tmpPromptsDir,
    })
    expect(result.writtenPaths).toBeInstanceOf(Array)
    expect(result.writtenPaths.length).toBeGreaterThan(0)
    for (const p of result.writtenPaths) {
      expect(p).toMatch(/\.(system\.ts|ts)$/)
    }
  })

  it('writtenPaths contains exactly the 4 expected prompt files', async () => {
    const result = await runCompile({
      runId: 'test-run',
      outputsDir: tmpOutputsDir,
      promptsDir: tmpPromptsDir,
    })
    const basenames = result.writtenPaths.map(p => p.split('/').at(-1))
    expect(basenames).toContain('_shared.system.ts')
    expect(basenames).toContain('decomposer.system.ts')
    expect(basenames).toContain('analyst.system.ts')
    expect(basenames).toContain('synthesizer.system.ts')
    expect(result.writtenPaths.length).toBe(4)
  })

  it('writtenPaths are absolute paths under promptsDir', async () => {
    const result = await runCompile({
      runId: 'test-run',
      outputsDir: tmpOutputsDir,
      promptsDir: tmpPromptsDir,
    })
    for (const p of result.writtenPaths) {
      expect(p.startsWith(tmpPromptsDir)).toBe(true)
    }
  })

  it('returns runId and promptsDir unchanged', async () => {
    const result = await runCompile({
      runId: 'test-run',
      outputsDir: tmpOutputsDir,
      promptsDir: tmpPromptsDir,
    })
    expect(result.runId).toBe('test-run')
    expect(result.promptsDir).toBe(tmpPromptsDir)
  })
})
