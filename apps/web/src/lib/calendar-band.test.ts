import { describe, expect, it } from 'vitest'
import { CALENDAR_BAND_MAX_ITEMS, calendarDayLabel, toCalendarBandEvents, toCalendarCoverageNotes } from './calendar-band.js'

describe('calendarDayLabel', () => {
  it('renders month / day plus the weekday character', () => {
    // 2026-07-25 是週六
    expect(calendarDayLabel('2026-07-25')).toBe('07 / 25 六')
  })
  it('keeps the leading zero（時間軸帶要對齊、不能一格兩位一格一位）', () => {
    expect(calendarDayLabel('2026-01-05')).toBe('01 / 05 一')
  })
  it('passes a malformed date through untouched instead of printing NaN', () => {
    expect(calendarDayLabel('not-a-date')).toBe('not-a-date')
  })
  it('passes an impossible date through untouched', () => {
    expect(calendarDayLabel('2026-13-45')).toBe('2026-13-45')
  })
})

describe('toCalendarBandEvents', () => {
  const macroHigh = { date: '2026-06-17', title: 'FOMC 利率決策', region: 'US' as const, importance: 'high' as const }
  const macroLow = { date: '2026-06-18', title: '美國初領失業金', region: 'US' as const, importance: 'low' as const }
  const exDiv = { date: '2026-06-16', title: '台積電除息 14 元', region: 'TW' as const, importance: 'high' as const, category: 'ex-dividend' as const }

  it('undefined 與空陣列都回空陣列——舊 brief 沒有這個欄位', () => {
    expect(toCalendarBandEvents(undefined)).toEqual([])
    expect(toCalendarBandEvents([])).toEqual([])
  })

  it('只帶版面需要的三個欄位', () => {
    expect(toCalendarBandEvents([exDiv, macroHigh])).toEqual([
      { date: '2026-06-16', title: '台積電除息 14 元', alert: false },
      { date: '2026-06-17', title: 'FOMC 利率決策', alert: true },
    ])
  })

  it('只有 high importance 的總經事件掛 alert', () => {
    expect(toCalendarBandEvents([macroLow])[0]?.alert).toBe(false)
  })

  it('公司事件即使 importance high 也不掛 alert——警報橙留給總經', () => {
    expect(toCalendarBandEvents([exDiv])[0]?.alert).toBe(false)
  })

  it('輸出一律照日期升冪，不信賴上游順序', () => {
    const out = toCalendarBandEvents([macroLow, exDiv, macroHigh])
    expect(out.map(e => e.date)).toEqual(['2026-06-16', '2026-06-17', '2026-06-18'])
  })

  it('超過上限就截斷——帶是水平捲的，塞滿三十筆等於沒有重點', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      ...macroLow,
      date: `2026-06-${String(1 + i).padStart(2, '0')}`,
      title: `事件 ${i}`,
    }))
    expect(toCalendarBandEvents(many)).toHaveLength(CALENDAR_BAND_MAX_ITEMS)
  })

  it('截斷時 high importance 的總經事件優先留下、留下的仍照日期序', () => {
    // 20 筆低重要度排在前面，FOMC 排在最後一天——單純 slice 會把它切掉。
    const filler = Array.from({ length: 20 }, (_, i) => ({
      date: `2026-06-${String(1 + i).padStart(2, '0')}`,
      title: `雜訊 ${i}`,
      region: 'US' as const,
      importance: 'low' as const,
    }))
    const out = toCalendarBandEvents([...filler, { ...macroHigh, date: '2026-06-29' }])
    expect(out.some(e => e.title === 'FOMC 利率決策')).toBe(true)
    const dates = out.map(e => e.date)
    expect([...dates].sort()).toEqual(dates)
  })
})

describe('toCalendarCoverageNotes', () => {
  const covered = { category: 'ex-dividend' as const, state: 'covered' as const, sourceEarliestDate: null }
  const confCovered = { category: 'investor-conference' as const, state: 'covered' as const, sourceEarliestDate: null }

  it('欄位不存在時不顯示註記——舊 brief 沒有這個欄位，不能把它講成任何一種狀態', () => {
    expect(toCalendarCoverageNotes(undefined)).toEqual([])
  })
  it('空陣列與全部 covered 都不顯示註記', () => {
    expect(toCalendarCoverageNotes([])).toEqual([])
    expect(toCalendarCoverageNotes([covered, confCovered])).toEqual([])
  })
  it('out-of-range 帶出來源最早日期，並講清楚「沒列出不代表沒有」', () => {
    const notes = toCalendarCoverageNotes([
      { category: 'ex-dividend', state: 'out-of-range', sourceEarliestDate: '2026-08-03' },
      confCovered,
    ])
    expect(notes).toHaveLength(1)
    expect(notes[0]?.category).toBe('ex-dividend')
    expect(notes[0]?.text).toContain('除權息')
    expect(notes[0]?.text).toContain('2026-08-03')
    expect(notes[0]?.text).toContain('不代表')
  })
  it('out-of-range 但沒有來源日期時不印 null', () => {
    const [note] = toCalendarCoverageNotes([
      { category: 'ex-dividend', state: 'out-of-range', sourceEarliestDate: null },
    ])
    expect(note?.text).toContain('除權息')
    expect(note?.text).not.toContain('null')
  })
  it('unavailable 不對讀者顯示——來源回零筆也會被判成這一類，淡季會天天出現', () => {
    expect(toCalendarCoverageNotes([
      { category: 'investor-conference', state: 'unavailable', sourceEarliestDate: null },
    ])).toEqual([])
  })
  it('兩類都 out-of-range 時各回一則，順序跟著輸入；混在一起的 unavailable 被略過', () => {
    const notes = toCalendarCoverageNotes([
      { category: 'investor-conference', state: 'out-of-range', sourceEarliestDate: '2026-08-10' },
      { category: 'ex-dividend', state: 'unavailable', sourceEarliestDate: null },
      { category: 'ex-dividend', state: 'out-of-range', sourceEarliestDate: '2026-08-03' },
    ])
    expect(notes.map(n => n.category)).toEqual(['investor-conference', 'ex-dividend'])
    expect(notes[0]?.text).toContain('法說會')
  })
})
