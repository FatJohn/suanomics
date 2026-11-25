import { describe, expect, it } from 'vitest'
import { exitCodeFor, parseDailyArgs } from './daily.cli-args.js'

describe('parseDailyArgs', () => {
  it('解析 --date 與 --force', () => {
    expect(parseDailyArgs(['--date', '2026-11-09', '--force'])).toEqual({ date: '2026-11-09', force: true })
    expect(parseDailyArgs(['--date', '2026-11-09'])).toEqual({ date: '2026-11-09', force: false })
  })

  it('略過 pnpm 轉傳的 -- 分隔符', () => {
    expect(parseDailyArgs(['--', '--date', '2026-11-09'])).toEqual({ date: '2026-11-09', force: false })
  })

  it.each([[[]], [['--date']], [['--date', '2026-13-01']], [['--date', '20261109']], [['--date', '2026-02-30']]])('拒絕不合法的日期 %j', (argv) => {
    expect(() => parseDailyArgs(argv)).toThrow('--date')
  })

  it('拒絕未知參數，打錯的 --forse 不可靜默變成不重跑', () => {
    expect(() => parseDailyArgs(['--date', '2026-11-09', '--forse'])).toThrow('--forse')
  })
})

describe('exitCodeFor', () => {
  it('skipped 與 complete 是 0，incomplete 非 0', () => {
    expect(exitCodeFor({ status: 'skipped', reason: 'already-exists', date: 'd' })).toBe(0)
    expect(exitCodeFor({ status: 'complete', date: 'd', briefId: 1 })).toBe(0)
    expect(exitCodeFor({ status: 'incomplete', date: 'd', failedStage: 'editor' })).toBe(1)
  })
})
