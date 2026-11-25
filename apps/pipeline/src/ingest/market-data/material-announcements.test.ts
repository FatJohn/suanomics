import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { companiesMentioned, filterAnnouncements, parseMaterialAnnouncements } from './material-announcements.js'

const fixture = (name: string): unknown[] => JSON.parse(readFileSync(new URL(`__fixtures__/${name}`, import.meta.url), 'utf-8')) as unknown[]

describe('parseMaterialAnnouncements', () => {
  it('解析 TWSE 回應（主旨欄名帶尾端空白、發言時間未補零）', () => {
    const [first] = parseMaterialAnnouncements(fixture('twse-t187ap04-l.json'), 'twse')
    expect(first).toMatchObject({ market: 'twse', companyCode: '2072', companyName: '世紀能源', clause: '第51款' })
    expect(first?.title).toContain('公告本公司名稱')
    expect(first?.title).not.toContain('\r')
    expect(first?.announcedAt.toISOString()).toBe('2026-11-06T23:00:03.000Z')
    expect(first?.body).toContain('事實發生日')
  })
  it('解析 TPEx 回應（不同的欄位名）', () => {
    const [first] = parseMaterialAnnouncements(fixture('tpex-t187ap04-o.json'), 'tpex')
    expect(first).toMatchObject({ market: 'tpex', companyCode: '3631', companyName: '晟楠', title: '本公司董事會決議通過子公司增資案' })
    expect(first?.announcedAt.toISOString()).toBe('2026-11-06T16:31:23.000Z')
  })
  it('缺代號或主旨的列略過', () => {
    expect(parseMaterialAnnouncements([{ 公司名稱: 'x', 發言日期: '1151107', 發言時間: '1' }], 'twse')).toEqual([])
  })
})

describe('filterAnnouncements', () => {
  it('只留指定公司', () => {
    const anns = parseMaterialAnnouncements(fixture('twse-t187ap04-l.json'), 'twse')
    expect(filterAnnouncements(anns, new Set(['2072'])).map(a => a.companyCode)).toContain('2072')
    expect(filterAnnouncements(anns, new Set(['9999']))).toEqual([])
  })
})

describe('companiesMentioned', () => {
  const companies = [{ code: '2330', name: '台積電' }, { code: '6488', name: '環球晶' }]
  it('以公司簡稱或代號比對入選新聞內文', () => {
    expect(companiesMentioned(['台積電上修資本支出', '代號 6488 公告'], companies)).toEqual(new Set(['2330', '6488']))
  })
  it('年份與點數這類四位數不算提到代號', () => {
    expect(companiesMentioned(['2330 點大關，6488 年'], companies)).toEqual(new Set())
    expect(companiesMentioned(['台達電（2330）公告'], companies)).toEqual(new Set(['2330']))
  })
  it('沒提到就是空集合', () => {
    expect(companiesMentioned(['央行維持利率不變'], companies)).toEqual(new Set())
  })
})
