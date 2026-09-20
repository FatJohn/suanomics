import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { pruneOldCandidates } from './prune-candidates.js'

describe('pruneOldCandidates', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = resolve(tmpdir(), `prune-test-${Date.now()}-${Math.random()}`)
    await mkdir(tmpDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  async function createRunDir(name: string, mtimeOffsetMs: number) {
    const path = join(tmpDir, name)
    await mkdir(path, { recursive: true })
    await writeFile(join(path, 'marker.txt'), name, 'utf-8')
    await new Promise(r => setTimeout(r, mtimeOffsetMs))
  }

  it('keeps maxRuns most recent dirs, removes older', async () => {
    for (let i = 0; i < 12; i++) {
      await createRunDir(`run-${String(i).padStart(3, '0')}`, 5)
    }
    const before = (await readdir(tmpDir)).sort()
    expect(before).toHaveLength(12)

    await pruneOldCandidates({ candidatesBase: tmpDir, maxRuns: 10 })

    const after = (await readdir(tmpDir)).sort()
    expect(after).toHaveLength(10)
    expect(after).not.toContain('run-000')
    expect(after).not.toContain('run-001')
    expect(after).toContain('run-002')
    expect(after).toContain('run-011')
  })

  it('no-op when dirs <= maxRuns', async () => {
    for (let i = 0; i < 5; i++) {
      await createRunDir(`run-${i}`, 2)
    }
    await pruneOldCandidates({ candidatesBase: tmpDir, maxRuns: 10 })
    const after = await readdir(tmpDir)
    expect(after).toHaveLength(5)
  })

  it('ignores non-directory entries', async () => {
    await writeFile(join(tmpDir, '.gitkeep'), '', 'utf-8')
    await writeFile(join(tmpDir, 'README.md'), '# notes', 'utf-8')
    for (let i = 0; i < 12; i++) {
      await createRunDir(`run-${String(i).padStart(3, '0')}`, 5)
    }
    await pruneOldCandidates({ candidatesBase: tmpDir, maxRuns: 10 })
    const after = await readdir(tmpDir)
    expect(after).toContain('.gitkeep')
    expect(after).toContain('README.md')
    expect(after.filter(n => n.startsWith('run-'))).toHaveLength(10)
  })
})
