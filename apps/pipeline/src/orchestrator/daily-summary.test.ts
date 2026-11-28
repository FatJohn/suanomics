import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { appendDailySummary, dailyWarning, renderDailySummary } from './daily-summary.js'

const D = '2026-11-09'

describe('renderDailySummary', () => {
  it('已有 incomplete 時寫出停下的 stage 與手動 --force 的做法', () => {
    const text = renderDailySummary({ status: 'skipped', reason: 'incomplete-exists', date: D, failedStage: 'analyst' })
    expect(text).toContain('## Daily brief')
    expect(text).toContain(D)
    expect(text).toContain('analyst')
    expect(text).toContain('--force')
  })

  it('停下的 stage 不明時照樣提示 --force', () => {
    const text = renderDailySummary({ status: 'skipped', reason: 'incomplete-exists', date: D, failedStage: null })
    expect(text).toContain('--force')
    expect(text).not.toContain('null')
  })

  it.each([
    [{ status: 'skipped', reason: 'already-exists', date: D } as const, '已有完整報告'],
    [{ status: 'skipped', reason: 'non-trading-day', date: D } as const, '非交易日'],
    [{ status: 'complete', date: D, briefId: 7 } as const, '完成'],
    [{ status: 'incomplete', date: D, failedStage: 'finalize' } as const, 'finalize'],
  ])('%j 有對應文字', (result, expected) => {
    expect(renderDailySummary(result)).toContain(expected)
  })
})

describe('dailyWarning', () => {
  it('只有 incomplete-exists 回 warning annotation', () => {
    const warning = dailyWarning({ status: 'skipped', reason: 'incomplete-exists', date: D, failedStage: 'analyst' })
    expect(warning?.startsWith('::warning title=Daily brief incomplete::')).toBe(true)
    expect(warning).toContain('--force')
    expect(dailyWarning({ status: 'skipped', reason: 'already-exists', date: D })).toBeUndefined()
    expect(dailyWarning({ status: 'complete', date: D, briefId: 7 })).toBeUndefined()
  })
})

describe('appendDailySummary', () => {
  it('附加到 summary 檔，不覆蓋前面步驟寫的內容', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'daily-summary-')), 's.md')
    writeFileSync(path, 'before\n')
    await appendDailySummary(path, 'after\n')
    expect(readFileSync(path, 'utf8')).toBe('before\nafter\n')
  })

  it('寫不進去只 warn，不丟錯', async () => {
    await expect(appendDailySummary(join(tmpdir(), 'no-such-dir-135', 's.md'), 'x')).resolves.toBeUndefined()
  })
})
