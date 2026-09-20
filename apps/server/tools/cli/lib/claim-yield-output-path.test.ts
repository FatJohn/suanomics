import { describe, expect, it, vi } from 'vitest'
import { freeOutPath, outPathFor, warnIfOutPathTaken } from './claim-yield-output-path.js'

const OUT = '/repo/.eval-out'

describe('outPathFor', () => {
  it('names the file after the taipei run date', () => {
    expect(outPathFor(OUT, new Date('2026-08-06T01:00:00+08:00')))
      .toBe(`${OUT}/2026-08-06-claim-yield-output.txt`)
  })

  // 台北清晨跑的話 UTC 還是前一天——用 UTC 命名會讓同一次跑被記到前一天。
  it('uses taipei date, not utc', () => {
    expect(outPathFor(OUT, new Date('2026-08-05T17:00:00Z')))
      .toBe(`${OUT}/2026-08-06-claim-yield-output.txt`)
  })
})

describe('freeOutPath', () => {
  it('returns the base name when nothing is there', () => {
    expect(freeOutPath(`${OUT}/2026-08-06-claim-yield-output.txt`, { exists: () => false }))
      .toBe(`${OUT}/2026-08-06-claim-yield-output.txt`)
  })

  // 這條就是這次的事故：同日重跑不得覆蓋前一份量測輸出。
  it('never returns a path that already exists', () => {
    const taken = new Set([
      `${OUT}/2026-08-06-claim-yield-output.txt`,
      `${OUT}/2026-08-06-claim-yield-output-2.txt`,
    ])
    expect(freeOutPath(`${OUT}/2026-08-06-claim-yield-output.txt`, { exists: p => taken.has(p) }))
      .toBe(`${OUT}/2026-08-06-claim-yield-output-3.txt`)
  })

  // 跑完才失敗＝丟掉 45 分鐘與 $2.7 的結果，比覆蓋更糟。所以它只換名、不 throw。
  it('still yields a writable path when every numbered slot is taken', () => {
    const out = freeOutPath(`${OUT}/x.txt`, { exists: p => !/-\d{6,}\.txt$/.test(p) })
    expect(out).toMatch(/^\/repo\/.*x-\d+\.txt$/)
  })
})

describe('warnIfOutPathTaken', () => {
  it('says so before a 45-minute run overwrites nothing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(warnIfOutPathTaken(`${OUT}/a.txt`, { exists: () => true })).toBe(true)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('已經跑過一次'))
    warn.mockRestore()
  })

  it('stays quiet when the path is free', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(warnIfOutPathTaken(`${OUT}/a.txt`, { exists: () => false })).toBe(false)
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })
})
