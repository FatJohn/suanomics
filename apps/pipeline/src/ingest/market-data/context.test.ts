import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadMarketContext, resolveCalendarCoverage } from './context.js'
import { SERIES_SPECS } from './series-config.js'

afterEach(() => vi.unstubAllGlobals())

describe('loadMarketContext', () => {
  it('returns null blocks on repo/file failure without throwing', async () => {
    const ctx = await loadMarketContext({
      getLatest: vi.fn(async () => {
        throw new Error('db down')
      }),
      readCalendarFile: vi.fn(async () => {
        throw new Error('no file')
      }),
      // ★ 這條測的是「全部 degrade」，所以每個外部依賴都要注入失敗。漏掉一個的症狀是
      //   它去打真實 DB、回真資料，然後這條測試變成在驗環境而不是驗 degrade
      //   （2026-08-28 加官方公告 block 時就是這樣紅的）。
      getOfficialAnnouncements: vi.fn(async () => {
        throw new Error('db down')
      }),
      fetchExDividend: async () => [],
      fetchInvestorConference: async () => [],
      now: new Date('2026-06-12T08:00:00Z'),
      reportDate: '2026-06-12',
    })
    // calendar 種子讀不到時 events 一起 degrade：空陣列而不是 undefined，讀者面才不用
    // 分辨「沒接上」與「今天沒事件」。
    // ★ fetchExDividend／fetchInvestorConference 這裡回的是 []、不是 throw——對
    // resolveCalendarCoverage 而言「回 0 筆」跟「抓取失敗」一樣判不出涵蓋範圍，兩類
    // coverage 都是 unavailable（補產除權息涵蓋狀態這次修正）。這正是這次改動要修的：calendarBlock **不再是
    // null**、而是帶著兩則「資料暫時無法取得」註記——不出聲的舊行為才是問題本身。
    expect(ctx).toEqual({
      snapshotBlock: null,
      calendarBlock: '## 本週公司事件\n- 除權息：資料暫時無法取得，本次未納入。\n- 法說會：資料暫時無法取得，本次未納入。',
      officialBlock: null,
      taiexCloseDate: null,
      dataFreshness: [],
      calendarEvents: [],
      calendarCoverage: [
        { category: 'ex-dividend', state: 'unavailable', sourceEarliestDate: null },
        { category: 'investor-conference', state: 'unavailable', sourceEarliestDate: null },
      ],
      citableSeries: [],
      seriesAnchors: [],
    })
  })

  // ★ 官方公告的窗必須錨在 reportDate、而且要有上界。錨在 now 的話，重生 6 月的報告
  //   會撈到今天的公告——那正是「同素材重跑」要排除的污染，而且它是靜默的
  //   （報告產得出來、只是多了當時不存在的素材）。判準同 getRelevanceCandidates。
  it('官方公告的窗錨在 reportDate、不是 now，且鎖住上界', async () => {
    let seen: { start: Date, end: Date } | null = null
    await loadMarketContext({
      getLatest: vi.fn(async () => []),
      getOfficialAnnouncements: async (start: Date, end: Date) => {
        seen = { start, end }
        return []
      },
      readCalendarFile: vi.fn(async () => JSON.stringify({ events: [] })),
      fetchExDividend: async () => [],
      fetchInvestorConference: async () => [],
      now: new Date('2026-08-28T09:00:00Z'),
      reportDate: '2026-06-12',
    })
    expect(seen).not.toBeNull()
    const w = seen as unknown as { start: Date, end: Date }
    // ★★ 界線也要是台北日界、不是 UTC 日界。證交所的公告全部落在 16:00Z（台北隔日
    // 00:00），用 UTC 界線會把台北當天的公告算進前一天的窗。
    expect(w.start.toISOString()).toBe('2026-06-08T16:00:00.000Z') // 台北 06-09 00:00
    expect(w.end.toISOString()).toBe('2026-06-12T15:59:59.999Z') // 台北 06-12 23:59:59.999
  })

  // ★ 序列快照與官方公告同一條紀律：上界錨在 reportDate。少了它，補跑歷史日期會把
  //   報告日之後的收盤價寫進正文（2026-09-05 實際踩到），而且不會有任何一層叫。
  //   這裡釘的是「有沒有把 reportDate 傳下去」——真正的過濾由 repo 那支真 DB 測試顧。
  it('序列快照的上界錨在 reportDate', async () => {
    const calls: Array<{ seriesId: string, limit: number, asOf?: string }> = []
    await loadMarketContext({
      getLatest: async (seriesId: string, limit: number, asOf?: string) => {
        calls.push({ seriesId, limit, ...(asOf === undefined ? {} : { asOf }) })
        return []
      },
      readCalendarFile: vi.fn(async () => JSON.stringify({ events: [] })),
      getOfficialAnnouncements: async () => [],
      fetchExDividend: async () => [],
      fetchInvestorConference: async () => [],
      now: new Date('2026-09-05T09:00:00Z'),
      reportDate: '2026-09-02',
    })
    expect(calls).toHaveLength(SERIES_SPECS.length)
    expect(calls.every(c => c.asOf === '2026-09-02')).toBe(true)
  })

  // seriesAsOf 覆寫。三種 key 狀態各自要對得上 loadSnapshot 的分支——
  // 這條測試漏了任何一支，突變（忽略 seriesAsOf／把 null 當缺項）都會悄悄綠燈過關。
  it('seriesAsOf 覆寫：存在值改查該日、null 不查、缺 key 回退 reportDate', async () => {
    const calls: Array<{ seriesId: string, limit: number, asOf?: string }> = []
    const ctx = await loadMarketContext({
      getLatest: async (seriesId: string, limit: number, asOf?: string) => {
        calls.push({ seriesId, limit, ...(asOf === undefined ? {} : { asOf }) })
        return [{ date: asOf ?? '2026-09-02', value: 1 }]
      },
      readCalendarFile: vi.fn(async () => JSON.stringify({ events: [] })),
      getOfficialAnnouncements: async () => [],
      fetchExDividend: async () => [],
      fetchInvestorConference: async () => [],
      now: new Date('2026-09-08T09:00:00Z'),
      reportDate: '2026-09-02',
      seriesAsOf: {
        'taiex-close': '2026-08-24',
        'foreign-taifex-net': null,
      },
    })
    const taiex = calls.find(c => c.seriesId === 'taiex-close')
    expect(taiex?.asOf).toBe('2026-08-24')

    // null 覆寫：完全不呼叫 getLatest，snapshot 直接是空陣列（不是回退去查 reportDate）。
    expect(calls.some(c => c.seriesId === 'foreign-taifex-net')).toBe(false)
    expect(ctx.dataFreshness.find(f => f.seriesId === 'foreign-taifex-net')).toMatchObject({ actualAsOf: null, state: 'missing' })

    // 缺 key（沒被 seriesAsOf 提到）：回退用 reportDate。
    const other = calls.find(c => c.seriesId !== 'taiex-close' && c.seriesId !== 'foreign-taifex-net')
    expect(other?.asOf).toBe('2026-09-02')
  })

  // ★ 行事曆窗與序列快照、官方公告同一條紀律：錨在 reportDate。這一條原本吃 now，
  //   所以補跑 09-02 的報告會印出「今天起算的未來七天」，而且那份 events 會被寫進
  //   brief 持久層給讀者面（2026-09-06 驗收指出，就在被修的那個函式下面兩行）。
  it('行事曆窗錨在 reportDate、不是 now', async () => {
    const events = [
      { date: '2026-09-02', title: '報告日當天', region: 'US', importance: 'high' },
      { date: '2026-09-04', title: '報告日後兩天（窗內）', region: 'US', importance: 'high' },
      { date: '2026-09-09', title: '報告日後第七天（邊界含）', region: 'US', importance: 'high' },
      { date: '2026-09-10', title: '報告日後第八天（窗外）', region: 'US', importance: 'high' },
    ]
    const ctx = await loadMarketContext({
      getLatest: vi.fn(async () => []),
      readCalendarFile: vi.fn(async () => JSON.stringify({ events })),
      getOfficialAnnouncements: async () => [],
      fetchExDividend: async () => [],
      fetchInvestorConference: async () => [],
      now: new Date('2026-09-05T09:00:00Z'),
      reportDate: '2026-09-02',
    })
    // 錨在 now 的話窗是 [09-05, 09-12]：09-02／09-04 會消失、09-10 會冒出來。
    expect(ctx.calendarEvents.map(e => e.date)).toEqual(['2026-09-02', '2026-09-04', '2026-09-09'])
    expect(ctx.calendarBlock).toContain('報告日當天')
    expect(ctx.calendarBlock).not.toContain('窗外')
  })

  it('builds blocks from repo points + calendar json', async () => {
    const ctx = await loadMarketContext({
      getLatest: vi.fn(async (seriesId: string) =>
        seriesId === 'taiex-close' ? [{ date: '2026-06-11', value: 23150 }] : []),
      readCalendarFile: vi.fn(async () =>
        JSON.stringify({ events: [{ date: '2026-06-17', title: 'FOMC 利率決策', region: 'US', importance: 'high' }] })),
      getOfficialAnnouncements: async () => [],
      fetchExDividend: async () => [],
      fetchInvestorConference: async () => [],
      now: new Date('2026-06-12T08:00:00Z'),
      reportDate: '2026-06-12',
    })
    // manifest 逐序列都要有一筆（含沒資料的），且判定用的是報告日而非「今天」
    expect(ctx.dataFreshness).toHaveLength(SERIES_SPECS.length)
    expect(ctx.dataFreshness.find(f => f.seriesId === 'taiex-close')).toEqual({
      seriesId: 'taiex-close',
      expectedAsOf: '2026-06-11',
      actualAsOf: '2026-06-11',
      lagCycles: 0,
      state: 'fresh',
    })
    expect(ctx.dataFreshness.find(f => f.seriesId === 'us-sox')?.state).toBe('missing')
    expect(ctx.snapshotBlock).toContain('加權指數')
    expect(ctx.calendarBlock).toContain('FOMC')
    expect(ctx.taiexCloseDate).toBe('2026-06-11')
  })

  // 讀者面拿的是 calendarEvents、LLM 拿的是 calendarBlock。兩者出自同一次載入與同一個
  // 視窗函式，所以「LLM 看到的行事曆」與「讀者看到的行事曆」不會有一邊有、一邊沒有。
  it('calendarEvents 帶回視窗內事件（含公司事件）、窗外的不帶', async () => {
    const ctx = await loadMarketContext({
      getLatest: vi.fn(async () => []),
      getOfficialAnnouncements: async () => [],
      readCalendarFile: vi.fn(async () => JSON.stringify({
        events: [
          { date: '2026-06-17', title: 'FOMC 利率決策', region: 'US', importance: 'high' },
          { date: '2026-06-30', title: '窗外事件', region: 'US', importance: 'high' },
        ],
      })),
      fetchExDividend: async () => [
        { date: '2026-06-16', title: '台積電除息', region: 'TW' as const, importance: 'medium' as const, category: 'ex-dividend' as const },
      ],
      fetchInvestorConference: async () => [],
      now: new Date('2026-06-12T08:00:00Z'),
      reportDate: '2026-06-12',
    })
    expect(ctx.calendarEvents.map(e => e.title)).toEqual(['台積電除息', 'FOMC 利率決策'])
    for (const e of ctx.calendarEvents)
      expect(ctx.calendarBlock).toContain(e.title)
    expect(ctx.calendarBlock).not.toContain('窗外事件')
  })

  // 兩半各自獨立 degrade：snapshot 半邊掛不應拖垮正常的 calendar 半邊。
  it('degrades snapshot independently from a healthy calendar', async () => {
    const ctx = await loadMarketContext({
      getLatest: vi.fn(async () => {
        throw new Error('db down')
      }),
      readCalendarFile: vi.fn(async () =>
        JSON.stringify({ events: [{ date: '2026-06-17', title: 'FOMC 利率決策', region: 'US', importance: 'high' }] })),
      getOfficialAnnouncements: async () => [],
      fetchExDividend: async () => [],
      fetchInvestorConference: async () => [],
      now: new Date('2026-06-12T08:00:00Z'),
      reportDate: '2026-06-12',
    })
    expect(ctx.snapshotBlock).toBeNull()
    expect(ctx.calendarBlock).toContain('FOMC')
    expect(ctx.taiexCloseDate).toBeNull()
  })

  it('種子將盡時 warn（最遠事件 < 30 天）', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await loadMarketContext({
      getLatest: vi.fn(async () => []),
      getOfficialAnnouncements: async () => [],
      readCalendarFile: vi.fn(async () =>
        JSON.stringify({ events: [{ date: '2026-07-20', title: 'x', region: 'US', importance: 'high' }] })),
      fetchExDividend: async () => [],
      fetchInvestorConference: async () => [],
      now: new Date('2026-07-13T08:00:00Z'),
      reportDate: '2026-07-13',
    })
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('種子將盡'))
    warnSpy.mockRestore()
  })

  it('種子健康時不 warn 種子將盡（最遠事件 >= 30 天）', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await loadMarketContext({
      getLatest: vi.fn(async () => []),
      getOfficialAnnouncements: async () => [],
      readCalendarFile: vi.fn(async () =>
        JSON.stringify({ events: [{ date: '2026-09-01', title: 'x', region: 'US', importance: 'high' }] })),
      fetchExDividend: async () => [],
      fetchInvestorConference: async () => [],
      now: new Date('2026-07-13T08:00:00Z'),
      reportDate: '2026-07-13',
    })
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('種子將盡'))
    warnSpy.mockRestore()
  })

  it('合併靜態種子 macro 與 live 抓的公司事件成兩區塊', async () => {
    const ctx = await loadMarketContext({
      getLatest: vi.fn(async () => []),
      getOfficialAnnouncements: async () => [],
      readCalendarFile: vi.fn(async () =>
        JSON.stringify({ events: [{ date: '2026-07-14', title: '美國 6 月 CPI', region: 'US', importance: 'high' }] })),
      fetchExDividend: vi.fn(async () => [{ date: '2026-07-16', title: '台積電（2330）除息', region: 'TW' as const, importance: 'medium' as const, category: 'ex-dividend' as const, companyCode: '2330' }]),
      fetchInvestorConference: vi.fn(async () => []),
      now: new Date('2026-07-13T08:00:00Z'),
      reportDate: '2026-07-13',
    })
    expect(ctx.calendarBlock).toContain('## 本週財經行事曆')
    expect(ctx.calendarBlock).toContain('## 本週公司事件')
    expect(ctx.calendarBlock).toContain('台積電（2330）除息')
  })

  // 補產除權息涵蓋狀態這次修正：公司事件抓取失敗不再靜默壓成空——macro 區塊不受影響，但「## 本週公司
  // 事件」現在一定要出現並附「資料暫時無法取得」註記，取代舊行為（整段省略）。
  it('公司事件抓取失敗時 macro 區塊不受影響、公司區塊改為出聲而非省略', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const ctx = await loadMarketContext({
      getLatest: vi.fn(async () => []),
      getOfficialAnnouncements: async () => [],
      readCalendarFile: vi.fn(async () =>
        JSON.stringify({ events: [{ date: '2026-07-14', title: '美國 6 月 CPI', region: 'US', importance: 'high' }] })),
      fetchExDividend: vi.fn(async () => { throw new Error('TWSE down') }),
      fetchInvestorConference: vi.fn(async () => { throw new Error('MOPS down') }),
      now: new Date('2026-07-13T08:00:00Z'),
      reportDate: '2026-07-13',
    })
    expect(ctx.calendarBlock).toContain('## 本週財經行事曆')
    expect(ctx.calendarBlock).toContain('## 本週公司事件')
    expect(ctx.calendarBlock).toContain('資料暫時無法取得')
    expect(ctx.calendarCoverage).toEqual([
      { category: 'ex-dividend', state: 'unavailable', sourceEarliestDate: null },
      { category: 'investor-conference', state: 'unavailable', sourceEarliestDate: null },
    ])
    warnSpy.mockRestore()
  })

  // 法說會 7 天窗的月份要錨在 reportDate、不是 now。★ 這裡刻意**不覆寫**
  // fetchInvestorConference——上面所有測試都覆寫掉了，測不到 context.ts 裡真正在修
  // 的那條預設接線（`fetchInvestorConferenceEvents({ now })`）。改攔截底層 HTTP
  // fetch，看 defaultFetchHtml 實際送出的民國年月，走的是 context.ts → 預設接線 →
  // investor-conference-source.ts → fetch 的完整路徑。
  function stubMopsFetch(): Array<{ year: string, month: string }> {
    const calls: Array<{ year: string, month: string }> = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      const body = new URLSearchParams(init.body as string)
      calls.push({ year: body.get('year') ?? '', month: body.get('month') ?? '' })
      return new Response('<table></table>', { status: 200 })
    }))
    return calls
  }

  it('法說會窗錨在 reportDate：補跑舊報告時查的是報告月、不是今天月', async () => {
    const calls = stubMopsFetch()
    await loadMarketContext({
      getLatest: vi.fn(async () => []),
      readCalendarFile: vi.fn(async () => JSON.stringify({ events: [] })),
      getOfficialAnnouncements: async () => [],
      fetchExDividend: async () => [],
      // fetchInvestorConference 不覆寫。
      now: new Date('2026-09-14T08:00:00Z'), // 執行當下（115/9）
      reportDate: '2026-06-10', // 補跑的報告日（115/6）——錨在 now 的話會查到 09 月
    })
    expect(calls).toEqual([{ year: '115', month: '06' }])
  })

  // positive control：reportDate 與 now 同一天時，查的仍是當月（不是這次改動改壞了正常路徑）。
  it('法說會窗 positive control：reportDate 與 now 同一天時查當月', async () => {
    const calls = stubMopsFetch()
    await loadMarketContext({
      getLatest: vi.fn(async () => []),
      readCalendarFile: vi.fn(async () => JSON.stringify({ events: [] })),
      getOfficialAnnouncements: async () => [],
      fetchExDividend: async () => [],
      now: new Date('2026-09-14T08:00:00Z'),
      reportDate: '2026-09-14',
    })
    expect(calls).toEqual([{ year: '115', month: '09' }])
  })

  // positive control：跨月 reportDate（+7 天窗跨到下個月）要抓兩個民國月份——
  // 證明錨點真的是 reportDate 本身、不是某個被誤用的單一月份常數。
  it('法說會窗 positive control：跨月 reportDate 查兩個民國月份', async () => {
    const calls = stubMopsFetch()
    await loadMarketContext({
      getLatest: vi.fn(async () => []),
      readCalendarFile: vi.fn(async () => JSON.stringify({ events: [] })),
      getOfficialAnnouncements: async () => [],
      fetchExDividend: async () => [],
      now: new Date('2026-01-01T08:00:00Z'), // 與 reportDate 差很遠、確保不是巧合對上
      reportDate: '2026-06-28', // +7 天＝07-05、跨到 7 月
    })
    expect(calls).toEqual([{ year: '115', month: '06' }, { year: '115', month: '07' }])
  })

  // 月界邊角：above 三條的 reportDate 都離月底太遠，錨點若誤用 `T00:00:00+08:00`
  // （UTC 減 8 小時）仍會巧合算出同樣的月份組合、測不出差異。這裡選 reportDate
  // 剛好讓「+7 天」落在下個月第一天（07-01）——用 +08:00 錨點時，anchor 與 end
  // 都還落在 UTC 6 月（時差把 07-01 00:00 台北拉回 06-30 16:00 UTC），
  // rocMonthsInWindow 只會查到 6 月、漏抓 07-01 那天的法說會。
  it('法說會窗月界：reportDate 使 +7 天窗落在下月第一天，仍要查到兩個月', async () => {
    const calls = stubMopsFetch()
    await loadMarketContext({
      getLatest: vi.fn(async () => []),
      readCalendarFile: vi.fn(async () => JSON.stringify({ events: [] })),
      getOfficialAnnouncements: async () => [],
      fetchExDividend: async () => [],
      now: new Date('2026-12-25T08:00:00Z'), // 與 reportDate 差很遠、確保不是巧合對上
      reportDate: '2026-06-24', // 窗 [06-24, 07-01]，07-01 落在窗內
    })
    expect(calls).toEqual([{ year: '115', month: '06' }, { year: '115', month: '07' }])
  })

  // 補產除權息涵蓋狀態這次修正：補產舊報告時，reportDate 早於除權息預告表最早一筆事件超過 7 天，
  // 窗內自然是空的——這條釘住「這不是靜默消失，會標出 out-of-range」。
  it('補產情境：reportDate 早於除權息來源最早事件 7 天以上 → out-of-range 且註記含來源日期', async () => {
    const ctx = await loadMarketContext({
      getLatest: vi.fn(async () => []),
      getOfficialAnnouncements: async () => [],
      readCalendarFile: vi.fn(async () => JSON.stringify({ events: [] })),
      fetchExDividend: async () => [
        { date: '2026-09-01', title: '台積電（2330）除息', region: 'TW' as const, importance: 'medium' as const, category: 'ex-dividend' as const, companyCode: '2330' },
      ],
      fetchInvestorConference: async () => [],
      now: new Date('2026-09-14T08:00:00Z'), // 執行當下
      reportDate: '2026-06-10', // 補產的報告日，窗尾 06-17 遠早於來源最早的 09-01
    })
    const exDivCoverage = ctx.calendarCoverage.find(c => c.category === 'ex-dividend')
    expect(exDivCoverage).toEqual({ category: 'ex-dividend', state: 'out-of-range', sourceEarliestDate: '2026-09-01' })
    expect(ctx.calendarBlock).toContain('## 本週公司事件')
    expect(ctx.calendarBlock).toContain('不適用')
    expect(ctx.calendarBlock).toContain('2026-09-01')
  })

  // 接線守衛：法說會那一類傳的是 supportsHistory: true（MOPS 端點吃 (民國年, 月)、查得到
  // 過去月份），所以它**永遠不該**被判成 out-of-range。那顆 true 沒有測試守的話，翻成
  // false 不會有任何東西變紅，而症狀是日報開始對法說會誤印「不適用」——誤叫比漏叫更快
  // 讓整個註記機制失去信任。這裡用與上一條完全相同的補產情境，只是換成法說會餵資料。
  it('法說會即使窗尾早於來源最早事件也不判 out-of-range（來源查得到歷史）', async () => {
    const ctx = await loadMarketContext({
      getLatest: vi.fn(async () => []),
      getOfficialAnnouncements: async () => [],
      readCalendarFile: vi.fn(async () => JSON.stringify({ events: [] })),
      fetchExDividend: async () => [],
      fetchInvestorConference: async () => [
        { date: '2026-09-01', title: '台積電（2330）法說會', region: 'TW' as const, importance: 'medium' as const, category: 'investor-conference' as const, companyCode: '2330' },
      ],
      now: new Date('2026-09-14T08:00:00Z'),
      reportDate: '2026-06-10', // 窗尾 06-17 遠早於 09-01，除權息那類會是 out-of-range
    })
    expect(ctx.calendarCoverage.find(c => c.category === 'investor-conference'))
      .toEqual({ category: 'investor-conference', state: 'covered', sourceEarliestDate: null })
    expect(ctx.calendarBlock ?? '').not.toContain('法說會：不適用')
  })
})

// 純函式，測試不必繞過整個 loadMarketContext。
describe('resolveCalendarCoverage', () => {
  const WINDOW_END = '2026-09-09'

  it('failed: true 但 events 非空 → unavailable（抓取失敗，不管拿到什麼都不可信）', () => {
    expect(resolveCalendarCoverage(
      'ex-dividend',
      { events: [{ date: '2026-09-01', title: 'x', region: 'TW', importance: 'medium', category: 'ex-dividend' }], failed: true },
      WINDOW_END,
      false,
    )).toEqual({ category: 'ex-dividend', state: 'unavailable', sourceEarliestDate: null })
  })

  it('events 空且 failed: false → unavailable（連判斷涵蓋範圍的依據都沒有）', () => {
    expect(resolveCalendarCoverage('ex-dividend', { events: [], failed: false }, WINDOW_END, false))
      .toEqual({ category: 'ex-dividend', state: 'unavailable', sourceEarliestDate: null })
  })

  it('窗尾早於來源最早日期一天 → out-of-range', () => {
    const result = resolveCalendarCoverage(
      'ex-dividend',
      { events: [{ date: '2026-09-10', title: 'x', region: 'TW', importance: 'medium', category: 'ex-dividend' }], failed: false },
      WINDOW_END, // 09-09，早來源 09-10 一天
      false,
    )
    expect(result).toEqual({ category: 'ex-dividend', state: 'out-of-range', sourceEarliestDate: '2026-09-10' })
  })

  // 邊界：窗尾「等於」來源最早日期時是 covered，不是 out-of-range——窗與來源範圍有
  // 交集（那一天），零事件在窗內就是真資訊。這條邊界最容易被 off-by-one 寫錯。
  it('窗尾等於來源最早日期 → covered（不是 out-of-range）', () => {
    const result = resolveCalendarCoverage(
      'ex-dividend',
      { events: [{ date: WINDOW_END, title: 'x', region: 'TW', importance: 'medium', category: 'ex-dividend' }], failed: false },
      WINDOW_END,
      false,
    )
    expect(result).toEqual({ category: 'ex-dividend', state: 'covered', sourceEarliestDate: null })
  })

  it('supportsHistory: true 時即使窗尾早於最早日期也回 covered（法說會不套 out-of-range）', () => {
    const result = resolveCalendarCoverage(
      'investor-conference',
      { events: [{ date: '2026-09-10', title: 'x', region: 'TW', importance: 'medium', category: 'investor-conference' }], failed: false },
      WINDOW_END, // 09-09，早於 09-10
      true,
    )
    expect(result).toEqual({ category: 'investor-conference', state: 'covered', sourceEarliestDate: null })
  })

  // 迴歸釘子：抓取失敗、回零筆、以及「有事件但都在窗外、窗尾仍 >= 最早日期」三種情境
  // 過去全部被壓成同一個 `[]`。這裡分開斷言，任何一種退回舊行為都會讓某一條紅。
  it('迴歸：抓取失敗與窗內無事件不再是同一回事', () => {
    expect(resolveCalendarCoverage(
      'ex-dividend',
      { events: [], failed: true },
      WINDOW_END,
      false,
    ).state).toBe('unavailable')

    expect(resolveCalendarCoverage(
      'ex-dividend',
      { events: [], failed: false },
      WINDOW_END,
      false,
    ).state).toBe('unavailable')

    // 有事件、都在窗外、但窗尾 >= 最早日期 → covered 且事件數為 0（真的沒有、不是抓不到）。
    const covered = resolveCalendarCoverage(
      'ex-dividend',
      { events: [{ date: '2026-09-01', title: 'x', region: 'TW', importance: 'medium', category: 'ex-dividend' }], failed: false },
      WINDOW_END, // 09-09 >= 09-01
      false,
    )
    expect(covered.state).toBe('covered')
  })
})
