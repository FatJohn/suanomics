import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { appendRunSummary } from './run-summary.js'

const USAGE = { totalUsd: 1, calls: 2, failed: 0, retries: 0, byAgent: [] }

describe('appendRunSummary', () => {
  it('把本次 run 的摘要附加到 summary 檔', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'summary-')), 's.md')
    await appendRunSummary({ runId: 'r', path, getUsage: async () => USAGE })
    expect(readFileSync(path, 'utf8')).toContain('$1.0000')
  })

  it('不在 Actions 裡就不查帳本', async () => {
    const getUsage = vi.fn(async () => USAGE)
    await appendRunSummary({ runId: 'r', path: undefined, getUsage })
    expect(getUsage).not.toHaveBeenCalled()
  })

  it('查帳本失敗只 warn，不蓋掉 run 本身的結果', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(appendRunSummary({ runId: 'r', path: '/nonexistent/x', getUsage: async () => Promise.reject(new Error('db down')) })).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
