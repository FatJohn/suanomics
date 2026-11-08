import { describe, expect, it } from 'vitest'
import twt48u from './__fixtures__/twse-twt48u.json'
import { fetchExDividendEvents } from './ex-dividend-source.js'

describe('fetchExDividendEvents', () => {
  it('只保留名單內公司、map 成帶 category 的 EconEvent、ROC 轉 ISO', async () => {
    const events = await fetchExDividendEvents({ fetchRows: async () => twt48u })
    const codes = events.map(e => e.companyCode).sort()
    // 0050 與 2330 在名單、00400A/9999 不在
    expect(codes).toEqual(['0050', '2330'])
    const tsmc = events.find(e => e.companyCode === '2330')
    expect(tsmc).toBeDefined()
    if (tsmc === undefined)
      return
    expect(tsmc.date).toBe('2026-07-18')
    expect(tsmc.category).toBe('ex-dividend')
    expect(tsmc.region).toBe('TW')
    expect(tsmc.importance).toBe('medium')
    expect(tsmc.title).toBe('台積電（2330）除息')
  })

  it('權息類型 label 正確（此 fixture 內名單外、驗 label 對照用另構造）', async () => {
    const events = await fetchExDividendEvents({
      fetchRows: async () => [{ Date: '1150801', Code: '2330', Name: '台積電', Exdividend: '權息', CashDividend: '1' }],
    })
    expect(events[0]?.title).toBe('台積電（2330）除權息')
  })

  it('非陣列 body 回空陣列（degrade）', async () => {
    const events = await fetchExDividendEvents({ fetchRows: async () => ({} as unknown) })
    expect(events).toEqual([])
  })
})
