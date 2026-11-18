import { describe, expect, it } from 'vitest'
import { parseJudgeArgs } from './judge-args.js'

describe('parseJudgeArgs', () => {
  it('預設跑兩個 judge、上限 US$3、輸出到 .eval-out/judge', () => {
    expect(parseJudgeArgs(['--dates', '2026-11-11,2026-11-12'])).toEqual({
      dates: ['2026-11-11', '2026-11-12'],
      judges: ['quality', 'continuity'],
      maxUsd: 3,
      dryRun: false,
      out: '.eval-out/judge',
      skipMissing: false,
      skipJudged: false,
      shadow: false,
    })
  })

  it('--shadow 只評 quality：continuity 比的是前幾日正式報告，影子報告不適用', () => {
    expect(parseJudgeArgs(['--dates', '2026-11-19', '--shadow'])).toMatchObject({ shadow: true, judges: ['quality'] })
    expect(parseJudgeArgs(['--dates', '2026-11-19', '--shadow', '--judge', 'quality'])).toMatchObject({ shadow: true, judges: ['quality'] })
    expect(() => parseJudgeArgs(['--dates', '2026-11-19', '--shadow', '--judge', 'continuity'])).toThrow(/--shadow/)
  })

  it('--shadow 不與排程旗標並用：已評判斷看的是正式報告的帳', () => {
    expect(() => parseJudgeArgs(['--dates', '2026-11-19', '--shadow', '--skip-judged'])).toThrow(/--shadow/)
  })

  it('可只跑一個 judge、改上限、dry-run 與輸出目錄；pnpm 傳進來的 -- 略過', () => {
    expect(parseJudgeArgs(['--', '--dates', '2026-11-17', '--judge', 'continuity', '--max-usd', '1.5', '--dry-run', '--out', '/tmp/x'])).toMatchObject({
      dates: ['2026-11-17'],
      judges: ['continuity'],
      maxUsd: 1.5,
      dryRun: true,
      out: '/tmp/x',
    })
  })

  it('沒給日期、日期格式錯或不存在的日期都擋下', () => {
    expect(() => parseJudgeArgs([])).toThrow(/--dates/)
    expect(() => parseJudgeArgs(['--dates', '2026-11-31'])).toThrow(/2026-11-31/)
    expect(() => parseJudgeArgs(['--dates', '2026/11/17'])).toThrow(/2026\/11\/17/)
  })

  it('重複日期擋下：同一天跑兩次只是多花錢', () => {
    expect(() => parseJudgeArgs(['--dates', '2026-11-17,2026-11-17'])).toThrow(/重複/)
  })

  it('未知 judge、非正數上限、未知參數都擋下', () => {
    expect(() => parseJudgeArgs(['--dates', '2026-11-17', '--judge', 'brief'])).toThrow(/--judge/)
    expect(() => parseJudgeArgs(['--dates', '2026-11-17', '--max-usd', '0'])).toThrow(/--max-usd/)
    expect(() => parseJudgeArgs(['--dates', '2026-11-17', '--force'])).toThrow(/--force/)
  })

  it('排程用的 --skip-missing、--skip-judged 預設關，給了才開', () => {
    expect(parseJudgeArgs(['--dates', '2026-11-17', '--skip-missing', '--skip-judged'])).toMatchObject({ skipMissing: true, skipJudged: true })
    expect(parseJudgeArgs(['--dates', '2026-11-17', '--skip-judged'])).toMatchObject({ skipMissing: false, skipJudged: true })
  })
})
