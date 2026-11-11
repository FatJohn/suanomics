import { checkCompliance, containsForbiddenPhrase, FORBIDDEN_PHRASES, HOLIDAY_COVERAGE_END } from '@suanomics/shared'
import { describe, expect, it } from 'vitest'
import { buildMarketClosureBlock, marketClosureBefore } from './market-closure.js'

// 日期全落在 2026 年、假日表已涵蓋的範圍（2026-07-21 起），不依賴 2027 資料。
describe('marketClosureBefore', () => {
  it('週五到週一：上一個交易日是週五、休市期間是週六日', () => {
    expect(marketClosureBefore('2026-09-14')).toEqual({
      previousTradingDay: '2026-09-11',
      calendarDays: 3,
      closedDays: ['2026-09-12', '2026-09-13'],
    })
  })

  it('連假：中秋（09-25 週五）接週末接教師節（09-28 週一），09-29 的上一個交易日是 09-24', () => {
    expect(marketClosureBefore('2026-09-29')).toEqual({
      previousTradingDay: '2026-09-24',
      calendarDays: 5,
      closedDays: ['2026-09-25', '2026-09-26', '2026-09-27', '2026-09-28'],
    })
  })

  it('國慶補假（10-09 週五）接週末，10-12 統整 10-09 到 10-11', () => {
    expect(marketClosureBefore('2026-10-12')?.closedDays).toEqual(['2026-10-09', '2026-10-10', '2026-10-11'])
  })

  it('一般交易日（前一天也開盤）不是休市後第一個交易日', () => {
    expect(marketClosureBefore('2026-09-15')).toBeNull()
  })

  it('報告日本身不是交易日（例如 force 在週日跑）時不算休市後第一個交易日', () => {
    expect(marketClosureBefore('2026-09-13')).toBeNull()
  })

  it('超出休市表涵蓋終點時不判定：錯的休市區間進 prompt 比沒有更壞', () => {
    // 由涵蓋終點推算，休市表往後延伸時這條仍然成立，不寫死 2027 日期。
    const afterEnd = new Date(Date.parse(`${HOLIDAY_COVERAGE_END}T00:00:00Z`) + 86_400_000)
    while (afterEnd.getUTCDay() !== 1)
      afterEnd.setUTCDate(afterEnd.getUTCDate() + 1)
    expect(marketClosureBefore(afterEnd.toISOString().slice(0, 10))).toBeNull()
  })

  it('美股休市不算：感恩節（11-26）台股照開，11-27 不是休市後第一個交易日', () => {
    expect(marketClosureBefore('2026-11-27')).toBeNull()
  })
})

describe('buildMarketClosureBlock', () => {
  it('一般交易日不產生統整指示', () => {
    expect(buildMarketClosureBlock('2026-09-15')).toBeNull()
  })

  it('休市後第一個交易日：交代上一個交易日、休市區間，並要求統整整段期間', () => {
    const block = buildMarketClosureBlock('2026-09-29') ?? ''
    expect(block).toContain('休市後第一個交易日')
    expect(block).toContain('9/24')
    expect(block).toContain('9/25（五）至 9/28（一）')
    expect(block).toContain('統整')
    // 只講「昨夜」會把四天的事件壓成一晚。
    expect(block).toContain('昨夜')
  })

  it('交代 system prompt 的「昨日收盤」「前夜美股」今天指哪一天，不讓兩邊指示互相矛盾', () => {
    const block = buildMarketClosureBlock('2026-09-29') ?? ''
    expect(block).toMatch(/「昨日收盤」[^\n]*9\/24（四）/)
    expect(block).toContain('「前夜美股」')
  })

  it('帶入 shared 的 compliance 禁用語清單', () => {
    const block = buildMarketClosureBlock('2026-09-14') ?? ''
    for (const phrase of FORBIDDEN_PHRASES)
      expect(block).toContain(phrase)
  })

  it('禁用語清單以外的指示本身不含禁用語', () => {
    const block = buildMarketClosureBlock('2026-09-14') ?? ''
    const instruction = block.split('\n').filter(line => !FORBIDDEN_PHRASES.every(p => line.includes(p))).join('\n')
    expect(instruction.length).toBeGreaterThan(0)
    expect(containsForbiddenPhrase(instruction).hit).toBe(false)
    expect(checkCompliance(instruction)).toBeNull()
  })
})
