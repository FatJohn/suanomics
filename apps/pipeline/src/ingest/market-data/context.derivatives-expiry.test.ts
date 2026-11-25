import { HOLIDAY_COVERAGE_END } from '@suanomics/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadMarketContext } from './context.js'
import { thirdWeekdayOfMonth } from './derivatives-expiry.js'

// 攔住 LLM 呼叫層：衍生品到期事件是規則算出來的，載入行事曆時一次都不該碰到 generateText。
const { generateText } = vi.hoisted(() => ({ generateText: vi.fn() }))
vi.mock('ai', async importOriginal => ({
  ...(await importOriginal<typeof import('ai')>()),
  generateText,
}))

afterEach(() => vi.restoreAllMocks())

function load(reportDate: string, events: unknown[] = []) {
  return loadMarketContext({
    getLatest: vi.fn(async () => []),
    readCalendarFile: vi.fn(async () => JSON.stringify({ events })),
    getOfficialAnnouncements: async () => [],
    fetchExDividend: async () => [],
    fetchInvestorConference: async () => [],
    now: new Date(`${reportDate}T00:00:00Z`),
    reportDate,
  })
}

describe('loadMarketContext 衍生品到期事件', () => {
  it('報告行事曆視窗內帶出台指期結算與四巫日，進 calendarEvents 與 calendarBlock，不呼叫 LLM', async () => {
    const ctx = await load('2027-06-14', [
      { date: '2027-06-16', title: 'FOMC 利率決策', region: 'US', importance: 'high' },
    ])
    expect(ctx.calendarEvents.map(e => [e.date, e.category])).toEqual([
      ['2027-06-16', undefined],
      ['2027-06-16', 'derivatives-expiry'],
      ['2027-06-17', 'derivatives-expiry'],
    ])
    expect(ctx.calendarBlock).toContain('- 2027-06-16：台指期 2027-06 月契約最後結算日（TW、medium）')
    expect(ctx.calendarBlock).toContain('- 2027-06-17：美股四巫日（2027-06 季度期貨與選擇權到期）（US、medium）')
    expect(generateText).not.toHaveBeenCalled()
  })

  it('種子檔讀不到時仍帶出到期事件（兩者獨立 degrade）', async () => {
    const ctx = await loadMarketContext({
      getLatest: vi.fn(async () => []),
      readCalendarFile: vi.fn(async () => {
        throw new Error('no file')
      }),
      getOfficialAnnouncements: async () => [],
      fetchExDividend: async () => [],
      fetchInvestorConference: async () => [],
      now: new Date('2027-06-14T00:00:00Z'),
      reportDate: '2027-06-14',
    })
    expect(ctx.calendarEvents.map(e => e.date)).toEqual(['2027-06-16', '2027-06-17'])
  })

  it('視窗超出休市表涵蓋範圍：不帶未經調整的日期，並 warn 列出是哪幾筆', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    // 休市表涵蓋終點隔年的 3 月：補表後跟著往後移，不會因為年度補表變紅。
    const beyond = Number(HOLIDAY_COVERAGE_END.slice(0, 4)) + 1
    const tw = thirdWeekdayOfMonth(beyond, 3, 3)
    const us = thirdWeekdayOfMonth(beyond, 3, 5)
    const ctx = await load(tw)
    expect(ctx.calendarEvents).toEqual([])
    const messages = warn.mock.calls.map(c => String(c[0]))
    expect(messages.some(m => m.includes('休市表涵蓋範圍') && m.includes(tw) && m.includes(us))).toBe(true)
  })

  it('涵蓋範圍內不發涵蓋告警', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await load('2027-06-14')
    expect(warn.mock.calls.map(c => String(c[0])).some(m => m.includes('休市表涵蓋範圍'))).toBe(false)
  })
})
