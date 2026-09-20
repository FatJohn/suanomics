import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { fetchInvestorConferenceEvents } from './investor-conference-source.js'

const HTML = readFileSync(new URL('./__fixtures__/mops-t100sb02.html', import.meta.url), 'utf-8')

describe('fetchInvestorConferenceEvents', () => {
  it('解析 HTML table、只保留名單內公司、map 成 investor-conference 事件', async () => {
    const events = await fetchInvestorConferenceEvents({
      fetchHtml: async () => HTML,
      now: new Date('2026-07-13T08:00:00Z'),
    })
    // 2330 在名單、1432 不在
    expect(events.map(e => e.companyCode)).toEqual(['2330'])
    expect(events.length).toBeGreaterThan(0)
    const e = events[0]
    if (!e)
      throw new Error('Expected at least one event')
    expect(e.date).toBe('2026-07-17')
    expect(e.title).toBe('台積電（2330）法說會')
    expect(e.category).toBe('investor-conference')
    expect(e.region).toBe('TW')
    expect(e.importance).toBe('medium')
  })

  it('7 天窗跨月時抓當月 + 次月（fetchHtml 被呼叫兩次）', async () => {
    const calls: Array<[number, number]> = []
    await fetchInvestorConferenceEvents({
      fetchHtml: async (y, m) => {
        calls.push([y, m])
        return '<table></table>'
      },
      now: new Date('2026-07-29T08:00:00Z'), // +7 天跨到 8 月
    })
    expect(calls).toEqual([[115, 7], [115, 8]])
  })

  it('同月時只抓一次', async () => {
    const calls: Array<[number, number]> = []
    await fetchInvestorConferenceEvents({
      fetchHtml: async (y, m) => {
        calls.push([y, m])
        return '<table></table>'
      },
      now: new Date('2026-07-13T08:00:00Z'),
    })
    expect(calls).toEqual([[115, 7]])
  })
})
