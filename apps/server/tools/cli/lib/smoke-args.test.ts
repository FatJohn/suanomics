import { afterEach, describe, expect, it, vi } from 'vitest'
import { argValue, parseDateList, parseLimit, parseLimitOrExit, requireGeminiKeyOrExit } from './smoke-args.js'

afterEach(() => vi.restoreAllMocks())

describe('parseLimit', () => {
  it('沒給 --limit 時回 0（＝不抽樣、跑全量）', () => {
    expect(parseLimit(undefined)).toBe(0)
  })

  it('正整數照收', () => {
    expect(parseLimit('2')).toBe(2)
    expect(parseLimit('0')).toBe(0)
  })

  // 這條是本函式存在的理由：Number('abc') 是 NaN、NaN > 0 是 false，
  // 呼叫端的 `limit > 0 ? slice : all` 會靜默跑全量，而報告字串也不會標 --limit
  // ——讀報告的人以為是抽樣、實際是全量。寧可當場停。
  it('非數字要拋錯而不是回 NaN', () => {
    expect(() => parseLimit('abc')).toThrow(/--limit/)
  })

  it('負數要拋錯', () => {
    expect(() => parseLimit('-1')).toThrow(/--limit/)
  })

  it('小數要拋錯（取樣筆數只能是整數）', () => {
    expect(() => parseLimit('1.5')).toThrow(/--limit/)
  })

  it('錯誤訊息要帶原始輸入，否則看不出打錯了什麼', () => {
    expect(() => parseLimit('abc')).toThrow(/abc/)
  })
})

describe('argValue', () => {
  it('取旗標後面那個值', () => {
    expect(argValue('--dates', ['--limit', '2', '--dates', '2026-08-13'])).toBe('2026-08-13')
  })

  it('旗標不存在時回 undefined', () => {
    expect(argValue('--dates', ['--limit', '2'])).toBeUndefined()
  })

  // 旗標放在最後一個位置時後面沒有值——回 undefined 而不是讓呼叫端拿到 index 越界。
  it('旗標在結尾時回 undefined', () => {
    expect(argValue('--dates', ['--dates'])).toBeUndefined()
  })
})

describe('parseDateList', () => {
  it('逗號分隔並去空白', () => {
    expect(parseDateList('2026-08-12, 2026-08-13')).toEqual(['2026-08-12', '2026-08-13'])
  })

  it('沒給旗標時回 undefined（＝不限定日期）', () => {
    expect(parseDateList(undefined)).toBeUndefined()
  })

  // `--dates ,,` 之類的輸入會得到空清單；回空陣列而不是 undefined，
  // 呼叫端才不會把「篩到零天」誤當成「沒指定、跑全部」。
  it('全是空白時回空陣列而不是 undefined', () => {
    expect(parseDateList(' , ')).toEqual([])
  })
})

describe('requireGeminiKeyOrExit', () => {
  it('有 key 時回傳值、不碰 process.exit', () => {
    vi.stubEnv('GEMINI_API_KEY', 'k-123')
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    expect(requireGeminiKeyOrExit('pnpm claim:yield')).toBe('k-123')
    expect(exit).not.toHaveBeenCalled()
  })

  // 每個腳本的啟動方式不同（pnpm alias / pnpm exec tsx / node 旗標），
  // 所以「怎麼跑才會載到 key」必須由呼叫端帶進來，不能寫死一句。
  it('沒 key 時把呼叫端給的啟動方式印進訊息並 exit 1', () => {
    vi.stubEnv('GEMINI_API_KEY', '')
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    requireGeminiKeyOrExit('pnpm ledger:ab')
    expect(exit).toHaveBeenCalledWith(1)
    expect(err).toHaveBeenCalledWith(expect.stringContaining('pnpm ledger:ab'))
    expect(err).toHaveBeenCalledWith(expect.stringContaining('GEMINI_API_KEY'))
  })
})

describe('parseLimitOrExit', () => {
  it('合法值直接回傳、不碰 process.exit', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    expect(parseLimitOrExit('3')).toBe(3)
    expect(exit).not.toHaveBeenCalled()
  })

  it('非法值印訊息並 exit 1，不吐 stack', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    parseLimitOrExit('abc')
    expect(exit).toHaveBeenCalledWith(1)
    expect(err).toHaveBeenCalledWith(expect.stringContaining('abc'))
  })
})
