import { readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import process from 'node:process'
import { afterEach, describe, expect, it } from 'vitest'
import { appendTrendRow, formatTrendRow, TREND_TABLE_HEADER } from './trend-log.js'

const ROW = {
  date: '2026-07-13',
  tool: 'quality',
  label: 'baseline vs t1',
  verdict: '深度:t1 可讀:tie grounding:baseline',
  cost: 0.0123,
}

describe('formatTrendRow', () => {
  it('產一行 markdown、cost 四位小數、備註欄留空', () => {
    expect(formatTrendRow(ROW)).toBe(
      '| 2026-07-13 | quality | baseline vs t1 | 深度:t1 可讀:tie grounding:baseline | 0.0123 |  |',
    )
  })
})

describe('appendTrendRow', () => {
  const path = resolve(tmpdir(), `trend-test-${process.pid}.md`)
  afterEach(async () => {
    await rm(path, { force: true })
  })

  it('檔不存在時建表頭 + 首列', async () => {
    await appendTrendRow(path, ROW)
    const out = await readFile(path, 'utf8')
    expect(out.startsWith(TREND_TABLE_HEADER)).toBe(true)
    expect(out).toContain(formatTrendRow(ROW))
  })

  it('檔已存在時 append、表頭只出現一次', async () => {
    await appendTrendRow(path, ROW)
    await appendTrendRow(path, { ...ROW, tool: 'continuity' })
    const out = await readFile(path, 'utf8')
    expect(out.split(TREND_TABLE_HEADER).length).toBe(2)
    expect(out).toContain('| 2026-07-13 | continuity |')
  })
})
