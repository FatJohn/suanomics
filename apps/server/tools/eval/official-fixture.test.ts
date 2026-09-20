import { describe, expect, it } from 'vitest'
import { buildOfficialFixtureBlock, OFFICIAL_FIXTURE_ITEMS, officialFixtureAnnouncements } from './official-fixture.js'

describe('officialFixtureAnnouncements', () => {
  it('把相對偏移錨到報告日的台北曆日', () => {
    const items = officialFixtureAnnouncements('2026-07-26')
    const cbc = items.find(a => a.title === '115年7月金融情況')
    expect(cbc).toBeDefined()
    // offsetDays=1、台北 16:20 → 2026-07-25T16:20+08:00 = 08:20Z
    expect(cbc?.publishedAt.toISOString()).toBe('2026-07-25T08:20:00.000Z')
  })

  it('證交所那批重現 16:00Z（＝台北隔日 00:00）的實際形狀', () => {
    const items = officialFixtureAnnouncements('2026-07-26')
    const twse = items.filter(a => a.slug === 'twse-announcements')
    expect(twse.length).toBeGreaterThan(0)
    for (const a of twse)
      expect(a.publishedAt.toISOString().slice(11)).toBe('16:00:00.000Z')
  })

  it('每一則都落在 prod 的 3 天回溯窗內', () => {
    const items = OFFICIAL_FIXTURE_ITEMS
    for (const f of items) {
      expect(f.offsetDays).toBeGreaterThanOrEqual(0)
      expect(f.offsetDays).toBeLessThanOrEqual(3)
    }
  })
})

describe('buildOfficialFixtureBlock', () => {
  it('印出的日期是台北曆日、不是 UTC 曆日', () => {
    const block = buildOfficialFixtureBlock('2026-07-26')
    expect(block).not.toBeNull()
    const lines = (block as string).split('\n')
    // 證交所那則台北曆日是 07-26（UTC 曆日會是 07-25），行首整段比對、不用子字串
    const twseLine = lines.find(l => l.includes('全體證券商'))
    expect(twseLine?.startsWith('- 2026-07-26（證交所）')).toBe(true)
  })

  it('日期跟著報告日移動', () => {
    const a = buildOfficialFixtureBlock('2026-07-26') as string
    const b = buildOfficialFixtureBlock('2026-01-01') as string
    expect(a.split('\n').every(l => l.startsWith('- 2026-07-2'))).toBe(true)
    expect(b.split('\n').every(l => /^- 2025-12-3|^- 2026-01-01/.test(l))).toBe(true)
  })

  it('四個機關都出現在 block 裡', () => {
    const block = buildOfficialFixtureBlock('2026-07-26') as string
    for (const agency of ['（央行）', '（金管會）', '（證交所）', '（行政院）'])
      expect(block.includes(agency)).toBe(true)
  })

  it('例行索引貼文被真的 builder 濾掉（fixture 刻意含一則）', () => {
    const raw = OFFICIAL_FIXTURE_ITEMS.filter(f => f.title.includes('每日新聞'))
    expect(raw.length).toBe(1)
    const block = buildOfficialFixtureBlock('2026-07-26') as string
    expect(block.includes('每日新聞')).toBe(false)
  })

  it('block 行數等於 fixture 扣掉被濾掉的那則', () => {
    const block = buildOfficialFixtureBlock('2026-07-26') as string
    expect(block.split('\n').length).toBe(OFFICIAL_FIXTURE_ITEMS.length - 1)
  })
})
