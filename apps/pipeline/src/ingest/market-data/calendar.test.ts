import type { CalendarCoverage } from '@suanomics/shared'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildCalendarBlock, CALENDAR_FRESHNESS_MIN_DAYS, daysUntilCalendarExhausted, EconCalendarSchema, selectCalendarWindow } from './calendar.js'

const NOW = new Date('2026-06-12T08:00:00Z')

describe('selectCalendarWindow', () => {
  const events = [
    { date: '2026-06-30', title: '太遠', region: 'US' as const, importance: 'high' as const },
    { date: '2026-06-18', title: '台灣央行理監事會', region: 'TW' as const, importance: 'high' as const },
    { date: '2026-06-17', title: 'FOMC 利率決策', region: 'US' as const, importance: 'high' as const },
    { date: '2026-06-11', title: '昨天', region: 'US' as const, importance: 'low' as const },
    { date: '2026-06-12', title: '台積電除息', region: 'TW' as const, importance: 'medium' as const, category: 'ex-dividend' as const },
  ]

  it('只留 [今日, 今日+7] 視窗內的事件、依日期升冪', () => {
    const out = selectCalendarWindow(events, NOW)
    expect(out.map(e => e.title)).toEqual(['台積電除息', 'FOMC 利率決策', '台灣央行理監事會'])
  })

  it('當日算在窗內、昨天不算（邊界含頭）', () => {
    expect(selectCalendarWindow(events, NOW).some(e => e.date === '2026-06-12')).toBe(true)
    expect(selectCalendarWindow(events, NOW).some(e => e.date === '2026-06-11')).toBe(false)
  })

  it('第 7 天算在窗內、第 8 天不算（邊界含尾）', () => {
    const edge = [
      { date: '2026-06-19', title: '第七天', region: 'US' as const, importance: 'low' as const },
      { date: '2026-06-20', title: '第八天', region: 'US' as const, importance: 'low' as const },
    ]
    expect(selectCalendarWindow(edge, NOW).map(e => e.title)).toEqual(['第七天'])
  })

  it('空輸入回空陣列、不回 null', () => {
    expect(selectCalendarWindow([], NOW)).toEqual([])
  })

  it('與 buildCalendarBlock 用同一個視窗（block 有的標題、window 也有）', () => {
    const block = buildCalendarBlock(events, NOW) ?? ''
    for (const e of selectCalendarWindow(events, NOW))
      expect(block).toContain(e.title)
    expect(block).not.toContain('太遠')
  })
})

describe('econCalendarSchema', () => {
  it('rejects malformed events', () => {
    expect(EconCalendarSchema.safeParse({ events: [{ date: 'not-a-date', title: '' }] }).success).toBe(false)
  })
})

describe('buildCalendarBlock', () => {
  it('lists events within 7 days sorted by date, null when none', () => {
    const events = [
      { date: '2026-06-30', title: '太遠', region: 'US' as const, importance: 'high' as const },
      { date: '2026-06-18', title: '台灣央行理監事會', region: 'TW' as const, importance: 'high' as const },
      { date: '2026-06-17', title: 'FOMC 利率決策', region: 'US' as const, importance: 'high' as const },
      { date: '2026-06-11', title: '昨天', region: 'US' as const, importance: 'low' as const },
    ]
    const out = buildCalendarBlock(events, NOW)
    expect(out).not.toBeNull()
    const text = out ?? ''
    expect(text).toContain('## 本週財經行事曆')
    expect(text.indexOf('2026-06-17')).toBeLessThan(text.indexOf('2026-06-18'))
    expect(out).not.toContain('太遠')
    expect(out).not.toContain('昨天')
    expect(buildCalendarBlock([], NOW)).toBeNull()
  })
})

describe('daysUntilCalendarExhausted', () => {
  const NOW = new Date('2026-07-13T08:00:00Z')
  it('回最遠事件距今日曆天數（正值、07-13→08-12=30）', () => {
    const events = [
      { date: '2026-07-20', title: 'a', region: 'US' as const, importance: 'high' as const },
      { date: '2026-08-12', title: 'b', region: 'US' as const, importance: 'high' as const },
    ]
    expect(daysUntilCalendarExhausted(events, NOW)).toBe(30)
  })
  it('最遠事件已過期回負值（07-13→07-10=-3）', () => {
    const events = [{ date: '2026-07-10', title: 'a', region: 'US' as const, importance: 'high' as const }]
    expect(daysUntilCalendarExhausted(events, NOW)).toBe(-3)
  })
  it('空陣列回 -Infinity', () => {
    expect(daysUntilCalendarExhausted([], NOW)).toBe(Number.NEGATIVE_INFINITY)
  })
  it('門檻常數為 30', () => {
    expect(CALENDAR_FRESHNESS_MIN_DAYS).toBe(30)
  })
})

describe('econ-calendar.json seed', () => {
  it('parses cleanly against EconCalendarSchema', async () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const raw = await readFile(resolve(here, '../../data/econ-calendar.json'), 'utf8')
    expect(() => EconCalendarSchema.parse(JSON.parse(raw))).not.toThrow()
  })
})

describe('econ-calendar.json seed freshness（time-bomb 守門）', () => {
  // 刻意用真實 new Date()：測的是「相對現在」的種子健康度。種子剩不足
  // CALENDAR_FRESHNESS_MIN_DAYS 天時本測試會自動變紅、逼人補種子或接自動源。
  // 這是預期設計、非 flaky——請勿因為它「有一天會紅」就移除。
  it('種子須覆蓋未來至少 CALENDAR_FRESHNESS_MIN_DAYS 天', async () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const raw = await readFile(resolve(here, '../../data/econ-calendar.json'), 'utf8')
    const { events } = EconCalendarSchema.parse(JSON.parse(raw))
    const days = daysUntilCalendarExhausted(events, new Date())
    expect(
      days,
      `econ-calendar 種子最遠事件距今僅 ${days} 天 < ${CALENDAR_FRESHNESS_MIN_DAYS}；`
      + `請補 apps/server/data/econ-calendar.json 或接自動源`
      + `（自動源可行性見 econ-calendar 的來源探測紀錄）`,
    ).toBeGreaterThanOrEqual(CALENDAR_FRESHNESS_MIN_DAYS)
  })
})

describe('buildCalendarBlock 分兩區塊', () => {
  const NOW = new Date('2026-07-13T08:00:00Z')
  const macro = { date: '2026-07-14', title: '美國 6 月 CPI', region: 'US' as const, importance: 'high' as const }
  const exDiv = { date: '2026-07-16', title: '元大台灣50（0050）除息', region: 'TW' as const, importance: 'medium' as const, category: 'ex-dividend' as const, companyCode: '0050' }
  const conf = { date: '2026-07-15', title: '台積電（2330）法說會', region: 'TW' as const, importance: 'medium' as const, category: 'investor-conference' as const, companyCode: '2330' }

  it('macro 事件出「本週財經行事曆」、帶 region/importance 後綴', () => {
    const out = buildCalendarBlock([macro], NOW) ?? ''
    expect(out).toContain('## 本週財經行事曆')
    expect(out).toContain('- 2026-07-14：美國 6 月 CPI（US、high）')
    expect(out).not.toContain('## 本週公司事件')
  })

  it('公司事件出「本週公司事件」、無 region/importance 後綴', () => {
    const out = buildCalendarBlock([exDiv, conf], NOW) ?? ''
    expect(out).toContain('## 本週公司事件')
    expect(out).toContain('- 2026-07-15：台積電（2330）法說會')
    expect(out).toContain('- 2026-07-16：元大台灣50（0050）除息')
    expect(out).not.toContain('（TW、medium）')
    expect(out).not.toContain('## 本週財經行事曆')
  })

  it('混合時 macro 區塊在前、以空行分隔、各區塊內升冪', () => {
    const out = buildCalendarBlock([exDiv, macro, conf], NOW) ?? ''
    expect(out.indexOf('## 本週財經行事曆')).toBeLessThan(out.indexOf('## 本週公司事件'))
    expect(out).toContain('## 本週財經行事曆\n- 2026-07-14')
    // 公司區塊內 07-15 在 07-16 前
    expect(out.indexOf('2026-07-15')).toBeLessThan(out.indexOf('2026-07-16'))
    expect(out).toContain('\n\n## 本週公司事件')
  })

  it('undefined category 視為 macro', () => {
    const out = buildCalendarBlock([macro], NOW) ?? ''
    expect(out).toContain('## 本週財經行事曆')
  })

  it('視窗內兩類都無時回 null', () => {
    expect(buildCalendarBlock([], NOW)).toBeNull()
  })
})

// 補產除權息涵蓋狀態這次修正：coverage 註記行。兩類皆 covered 時輸出必須與不傳 coverage 逐字相同——
// 這是「沒有 regress 現行行為」的釘子，用 toBe 比對整段字串、不只比長度。
describe('buildCalendarBlock 帶 coverage 註記', () => {
  const NOW = new Date('2026-07-13T08:00:00Z')
  const exDiv = { date: '2026-07-16', title: '元大台灣50（0050）除息', region: 'TW' as const, importance: 'medium' as const, category: 'ex-dividend' as const, companyCode: '0050' }
  const covered: CalendarCoverage[] = [
    { category: 'ex-dividend', state: 'covered', sourceEarliestDate: null },
    { category: 'investor-conference', state: 'covered', sourceEarliestDate: null },
  ]

  it('兩類皆 covered 時，輸出與不傳 coverage 逐字相同', () => {
    const withCoverage = buildCalendarBlock([exDiv], NOW, 7, covered)
    const without = buildCalendarBlock([exDiv], NOW)
    expect(withCoverage).toBe(without)
  })

  it('out-of-range 時「本週公司事件」區塊出現、且註記行含來源最早日期', () => {
    const coverage: CalendarCoverage[] = [
      { category: 'ex-dividend', state: 'out-of-range', sourceEarliestDate: '2026-09-01' },
      { category: 'investor-conference', state: 'covered', sourceEarliestDate: null },
    ]
    const out = buildCalendarBlock([], NOW, 7, coverage) ?? ''
    expect(out).toContain('## 本週公司事件')
    expect(out).toContain('2026-09-01')
    expect(out).toContain('不適用')
  })

  it('unavailable 時附「資料暫時無法取得」註記', () => {
    const coverage: CalendarCoverage[] = [
      { category: 'ex-dividend', state: 'unavailable', sourceEarliestDate: null },
      { category: 'investor-conference', state: 'covered', sourceEarliestDate: null },
    ]
    const out = buildCalendarBlock([], NOW, 7, coverage) ?? ''
    expect(out).toContain('## 本週公司事件')
    expect(out).toContain('資料暫時無法取得')
  })

  it('companyLines 為空但有非 covered 狀態時，區塊仍出現（不因為沒有事件就整段省略）', () => {
    const coverage: CalendarCoverage[] = [
      { category: 'ex-dividend', state: 'unavailable', sourceEarliestDate: null },
      { category: 'investor-conference', state: 'covered', sourceEarliestDate: null },
    ]
    expect(buildCalendarBlock([], NOW, 7, coverage)).not.toBeNull()
  })

  // out-of-range 的註記要說出「射程是誰的射程」，而來源名必須跟著 category 走。
  // `resolveCalendarCoverage` 的 supportsHistory 是參數，任何一類都可能被判成
  // out-of-range——來源名若寫死成除權息那一份，法說會會印出別人的來源名，而且靜默。
  // 這兩條就是釘住「別把來源名寫死」。
  it('out-of-range 的來源名跟著 category 走：除權息印 TWSE 預告表', () => {
    const coverage: CalendarCoverage[] = [
      { category: 'ex-dividend', state: 'out-of-range', sourceEarliestDate: '2026-09-01' },
    ]
    const out = buildCalendarBlock([], NOW, 7, coverage) ?? ''
    expect(out).toContain('除權息：不適用。資料來源是 TWSE 除權息預告表')
  })

  // 註記行印的天數要吃這次實際採用的 horizonDays，不是常數預設值——非預設呼叫時
  // 印常數等於對讀者說錯射程。production 目前都走預設值，所以這條是唯一守得住它的。
  it('註記行的天數跟著實際 horizonDays 走，不是常數預設值', () => {
    const coverage: CalendarCoverage[] = [
      { category: 'ex-dividend', state: 'out-of-range', sourceEarliestDate: '2026-09-01' },
    ]
    const out = buildCalendarBlock([], NOW, 30, coverage) ?? ''
    expect(out).toContain('本報告日的 30 天窗')
    expect(out).not.toContain('本報告日的 7 天窗')
  })

  it('out-of-range 的來源名跟著 category 走：法說會不得印出除權息的來源名', () => {
    const coverage: CalendarCoverage[] = [
      { category: 'investor-conference', state: 'out-of-range', sourceEarliestDate: '2026-09-01' },
    ]
    const out = buildCalendarBlock([], NOW, 7, coverage) ?? ''
    expect(out).toContain('法說會：不適用。資料來源是 MOPS 法說會公告')
    expect(out).not.toContain('除權息預告表')
  })
})
