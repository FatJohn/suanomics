import type { SeriesSpec } from './series-config.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchNasdaqSeries, overlayInfoPoint, parseNasdaqHistorical, parseNasdaqInfo } from './nasdaq-client.js'

// 三份 fixture 皆為 2026-07-31 對 api.nasdaq.com 的實測回應（照抄真形狀、非手寫想像）。
// 交易日：rows 走 tradesTable.rows、close 帶千分位、date 為 MM/DD/YYYY。
const OK_BODY = {
  data: {
    symbol: 'SOX',
    totalRecords: 3,
    tradesTable: {
      asOf: null,
      headers: { date: 'Date', close: 'Close/Last', volume: 'Volume', open: 'Open', high: 'High', low: 'Low' },
      rows: [
        { date: '07/30/2026', close: '11,302.99', volume: '--', open: '11,085.96', high: '11,406.82', low: '10,963.90' },
        { date: '07/29/2026', close: '10,447.49', volume: '--', open: '11,011.87', high: '11,125.05', low: '10,445.44' },
        { date: '07/28/2026', close: '11,035.68', volume: '--', open: '11,150.04', high: '11,187.44', low: '10,799.84' },
      ],
    },
  },
  message: null,
  status: { rCode: 200, bCodeMessage: null, developerMessage: null },
}

// 查詢窗內無交易日（週末）：data 存在但 tradesTable 為 null——**rows 這個 key 根本不存在**。
const EMPTY_WINDOW_BODY = {
  data: { symbol: null, totalRecords: 0, tradesTable: null },
  message: null,
  status: { rCode: 200, bCodeMessage: null, developerMessage: null },
}

// 錯誤符號：HTTP 仍是 200、只有 rCode 400 + data 整個為 null。設定錯誤要吵、不可 graceful。
const BAD_SYMBOL_BODY = {
  data: null,
  message: null,
  status: { rCode: 400, bCodeMessage: [{ code: 1001, errorMessage: 'Symbol not exists.' }], developerMessage: null },
}

// `/api/quote/SOX/info`：2026-08-04 15:1x 台北的實測回應（照抄真形狀）。
// 注意 marketStatus 在 data 這一層、**不在 primaryData 裡**。
const INFO_BODY = {
  data: {
    symbol: 'SOX',
    companyName: 'PHLX Semiconductor Sector',
    stockType: '',
    exchange: 'Index',
    isNasdaqListed: false,
    primaryData: {
      lastSalePrice: '11,430.35',
      netChange: '+119.27',
      percentageChange: '+1.05%',
      deltaIndicator: 'up',
      lastTradeTimestamp: 'Aug 3, 2026',
      isRealTime: false,
      bidPrice: '',
      askPrice: '',
      bidSize: '',
      askSize: '',
      volume: '',
      currency: null,
    },
    secondaryData: null,
    marketStatus: 'Closed',
    assetClass: 'INDEX',
    keyStats: {
      previousclose: { label: 'Previous Close:', value: '11,311.08' },
      dayrange: { label: 'Day Range:', value: '10,922.31 - 11,495.28' },
    },
    notifications: null,
  },
  message: null,
  status: { rCode: 200, bCodeMessage: null, developerMessage: null },
}

// 覆寫 INFO_BODY.data.primaryData 的單一欄位（省掉每個 case 重打整份巢狀 fixture）。
function infoWith(patch: Record<string, unknown>): unknown {
  return { ...INFO_BODY, data: { ...INFO_BODY.data, primaryData: { ...INFO_BODY.data.primaryData, ...patch } } }
}

// 覆寫 INFO_BODY.data 這一層（marketStatus、symbol 等 gate 欄位）。
function infoWithData(patch: Record<string, unknown>): unknown {
  return { ...INFO_BODY, data: { ...INFO_BODY.data, ...patch } }
}

// 08-03 缺席、最新是 07-31（＝ historical 延遲補齊那次事故在 06:26 台北實際拿到的狀態）。
const HIST_LAGGING = [
  { date: '2026-07-31', value: 11311.08 },
  { date: '2026-07-30', value: 11302.99 },
]

// `/info` 已與 OK_BODY 最新列（07/30、11,302.99）同日且自洽：11,302.99 − 855.50 = 10,447.49
// ＝ OK_BODY 的 07/29 收盤。對應「`/historical` 已自己補齊」的狀態，疊加應為 no-op。
const INFO_SAME_DAY_AS_OK_BODY = infoWith({
  lastTradeTimestamp: 'Jul 30, 2026',
  lastSalePrice: '11,302.99',
  netChange: '+855.50',
})

function okJson(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 })
}

// fetchNasdaqSeries 會打兩個端點；照 URL 分流，才不會讓 `/info` 收到 historical 的形狀。
function routedFetch(histBody: unknown, infoBody: unknown): ReturnType<typeof vi.fn> {
  return vi.fn(async (url: unknown) => okJson(String(url).includes('/info') ? infoBody : histBody))
}

function silenceWarn(): { restore: () => void, spy: ReturnType<typeof vi.spyOn> } {
  const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  return { spy, restore: () => spy.mockRestore() }
}

// 疊加結果行走 console.log（實測託管平台 runtime log 同時收 log 與 warn）。
// 回傳 `line()` 而不是 spy 本身：斷言要看的是那一行的內容，不是它被呼叫幾次。
function captureLog(): { restore: () => void, line: () => string } {
  const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
  return {
    restore: () => spy.mockRestore(),
    line: () => spy.mock.calls.map(c => String(c[0])).find(s => s.includes('overlay outcome')) ?? '',
  }
}

// client 只吃 sourceCode（Nasdaq symbol）；刻意不從 SERIES_SPECS 取，讓本檔獨立於序列是否已註冊。
function specOf(sourceCode: string): SeriesSpec {
  return {
    seriesId: `test-${sourceCode.toLowerCase()}`,
    source: 'nasdaq',
    sourceCode,
    displayName: sourceCode,
    unit: '點',
    frequency: 'daily',
    transform: 'level',
    section: 'us-equity',
    kind: 'level',
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('parseNasdaqHistorical', () => {
  it('maps rows to RawPoint（MM/DD/YYYY → ISO、close 去千分位）', () => {
    expect(parseNasdaqHistorical(OK_BODY, 'SOX')).toEqual([
      { date: '2026-07-30', value: 11302.99 },
      { date: '2026-07-29', value: 10447.49 },
      { date: '2026-07-28', value: 11035.68 },
    ])
  })

  it('returns empty for 查詢窗無交易日（tradesTable 為 null、無 rows key）', () => {
    expect(parseNasdaqHistorical(EMPTY_WINDOW_BODY, 'SOX')).toEqual([])
  })

  it('throws when data is null（錯誤符號 / rCode 400）', () => {
    expect(() => parseNasdaqHistorical(BAD_SYMBOL_BODY, 'ZZZNOPE')).toThrow(/ZZZNOPE/)
  })

  it('skips rows with unparseable date or close（端點欄位漂移不整批炸掉）', () => {
    const body = {
      data: {
        symbol: 'SOX',
        tradesTable: {
          rows: [
            { date: '07/30/2026', close: '11,302.99' },
            { date: 'N/A', close: '1,000.00' },
            { date: '07/29/2026', close: '--' },
          ],
        },
      },
      status: { rCode: 200 },
    }
    expect(parseNasdaqHistorical(body, 'SOX')).toEqual([{ date: '2026-07-30', value: 11302.99 }])
  })

  // Number('') 是 0、且 Number.isFinite(0) 為 true——空字串收盤價會靜默變成「0 點」印進
  // 已發布的報告（實測：費半 0 點、前值 11,303、-100%），比整批失敗危險得多。
  // 同一個 root cause 也讓 '0x1F' → 31、'1e5' → 100000、歐系 '11.302,99' → 11.30299
  // （差 1000 倍且為有限值）照樣通過。這些形狀一律視為無效值、跳過該列。
  it.each([
    ['空字串', ''],
    ['純空白', ' '],
    ['只剩 $ 前綴', '$'],
    ['十六進位', '0x1F'],
    ['科學記號', '1e5'],
    ['歐系小數點千分位', '11.302,99'],
  ])('skips a row whose close is %s（不得靜默轉成數字）', (_label, close) => {
    const body = {
      data: {
        symbol: 'SOX',
        tradesTable: {
          rows: [
            { date: '07/29/2026', close },
            { date: '07/30/2026', close: '11,302.99' },
          ],
        },
      },
      status: { rCode: 200 },
    }
    expect(parseNasdaqHistorical(body, 'SOX')).toEqual([{ date: '2026-07-30', value: 11302.99 }])
  })

  // 只驗位數不驗曆日會產出 '2026-13-45'：進 upsert 時 Postgres date 欄讓整批 INSERT 炸掉
  // （同批合法列一起丟失）；真落地則讓 snapshot 的 calendarDaysBetween 回 NaN、
  // NaN > 5 為 false 而**繞過**過期守衛。故轉換後要核對是真實曆日。
  it.each([
    ['月份 13、日 45', '13/45/2026'],
    ['2 月 30 日', '02/30/2026'],
  ])('skips a row whose date is %s（位數合法但非真實曆日）', (_label, date) => {
    const body = {
      data: {
        symbol: 'SOX',
        tradesTable: {
          rows: [
            { date, close: '9,999.99' },
            { date: '07/30/2026', close: '11,302.99' },
          ],
        },
      },
      status: { rCode: 200 },
    }
    expect(parseNasdaqHistorical(body, 'SOX')).toEqual([{ date: '2026-07-30', value: 11302.99 }])
  })

  it('keeps a real leap day（曆日檢查不得誤殺 02/29）', () => {
    const body = {
      data: { symbol: 'SOX', tradesTable: { rows: [{ date: '02/29/2024', close: '4,000.00' }] } },
      status: { rCode: 200 },
    }
    expect(parseNasdaqHistorical(body, 'SOX')).toEqual([{ date: '2024-02-29', value: 4000 }])
  })

  // 端點對 symbol 很寬鬆（實測 'sox'、'SOX%20' 都回 200 並照抄 SOX 資料），回應自帶的
  // data.symbol 是唯一能確認「拿到的是不是我要的那檔」的免費守衛。
  it('throws when data.symbol 與請求的 symbol 不符（fuzzy match / 代碼遷移）', () => {
    const body = {
      data: { symbol: 'COMP', tradesTable: { rows: [{ date: '07/30/2026', close: '25,122.18' }] } },
      status: { rCode: 200 },
    }
    expect(() => parseNasdaqHistorical(body, 'SOX')).toThrow(/SOX/)
  })

  it('accepts data.symbol differing only by case/前後空白', () => {
    const body = {
      data: { symbol: ' sox ', tradesTable: { rows: [{ date: '07/30/2026', close: '11,302.99' }] } },
      status: { rCode: 200 },
    }
    expect(parseNasdaqHistorical(body, 'SOX')).toEqual([{ date: '2026-07-30', value: 11302.99 }])
  })

  it('returns empty when rows is not an array（shape 漂移 → graceful degrade）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(parseNasdaqHistorical({ data: { tradesTable: { rows: 'nope' } }, status: { rCode: 200 } }, 'SOX')).toEqual([])
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('fetchNasdaqSeries', () => {
  const NOW = new Date('2026-07-30T22:10:00Z')

  it('builds the historical URL with assetclass=index + UTC 14 天窗', async () => {
    const spy = routedFetch(OK_BODY, INFO_SAME_DAY_AS_OK_BODY)
    vi.stubGlobal('fetch', spy)
    await fetchNasdaqSeries(specOf('SOX'), NOW)
    const url = String(spy.mock.calls[0]?.[0])
    expect(url).toContain('https://api.nasdaq.com/api/quote/SOX/historical')
    expect(url).toContain('assetclass=index')
    expect(url).toContain('todate=2026-07-30')
    expect(url).toContain('fromdate=2026-07-16')
    expect(url).toContain('limit=10')
  })

  // 實測：不帶 User-Agent 時連線直接失敗（curl http_code=000），不是 4xx——沒有這個標頭這條路整條死。
  it('sends a User-Agent header（不帶時端點直接斷線）', async () => {
    // 這個 case 刻意用第二個 symbol；body 的 data.symbol 要跟著對齊，
    // 否則會先撞到 symbol 不符的守衛而測不到標頭。
    const compHist = { ...OK_BODY, data: { ...OK_BODY.data, symbol: 'COMP' } }
    const spy = routedFetch(compHist, infoWithData({ symbol: 'COMP' }))
    vi.stubGlobal('fetch', spy)
    const warn = silenceWarn() // COMP 的 info fixture 與 historical 不同步，會走 degrade 並 warn
    await fetchNasdaqSeries(specOf('COMP'), NOW)
    warn.restore()
    const init = spy.mock.calls[0]?.[1] as { headers?: Record<string, string> } | undefined
    expect(init?.headers?.['User-Agent']).toBeTruthy()
  })

  it('parses a successful response into points', async () => {
    vi.stubGlobal('fetch', routedFetch(OK_BODY, INFO_SAME_DAY_AS_OK_BODY))
    await expect(fetchNasdaqSeries(specOf('SOX'), NOW)).resolves.toEqual([
      { date: '2026-07-30', value: 11302.99 },
      { date: '2026-07-29', value: 10447.49 },
      { date: '2026-07-28', value: 11035.68 },
    ])
  })

  it('throws including symbol + status on non-200', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 503 })))
    await expect(fetchNasdaqSeries(specOf('SOX'), NOW)).rejects.toThrow(/SOX.*503/)
  })

  it('wraps AbortError into a timeout message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      const e = new Error('aborted')
      e.name = 'AbortError'
      throw e
    }))
    await expect(fetchNasdaqSeries(specOf('SOX'), NOW, 5)).rejects.toThrow(/timeout after 5ms/)
  })
})

describe('parseNasdaqInfo', () => {
  it('讀出最新點與 netChange 推得的前值（historical 延遲補齊事故的實測 payload）', () => {
    const point = parseNasdaqInfo(INFO_BODY, 'SOX')
    expect(point?.date).toBe('2026-08-03')
    expect(point?.value).toBe(11430.35)
    // 11,430.35 − 119.27；浮點尾差是必然，故用 closeTo 而非嚴格相等。
    expect(point?.impliedPrevClose).toBeCloseTo(11311.08, 6)
  })

  it('負的 netChange 推得較高的前值（下跌日）', () => {
    const point = parseNasdaqInfo(infoWith({ netChange: '-119.27', deltaIndicator: 'down' }), 'SOX')
    expect(point?.impliedPrevClose).toBeCloseTo(11549.62, 6)
  })

  // 硬 gate 的白名單只有兩個值。`Open` 與 `Pre-Market` 的 lastSalePrice／lastTradeTimestamp
  // 不是當日最終收盤（前者是盤中即時價，後者根本還停在前一交易日），採用就是寫進假收盤價。
  it('marketStatus 不在白名單一律不採用', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(parseNasdaqInfo(infoWithData({ marketStatus: 'Open' }), 'SOX')).toBeNull()
    expect(parseNasdaqInfo(infoWithData({ marketStatus: 'Pre-Market' }), 'SOX')).toBeNull()
    expect(parseNasdaqInfo(infoWithData({ marketStatus: null }), 'SOX')).toBeNull()
    warn.mockRestore()
  })

  // 2026-08-07 prod 實測（ET 週五 17:53）：`marketStatus=After-Hours`、`ts=Aug 7, 2026`
  // ——延長時段的 /info 帶的就是當日最終收盤，而 /historical 當下還停在 T-1。
  // 這正是每天沿用 T-1 那次事故的成因，故 After-Hours 必須放行。
  it.each(['Closed', 'After-Hours'])('marketStatus 為 %s 時採用，且不 warn（正常路徑不得有雜訊）', (status) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(parseNasdaqInfo(infoWithData({ marketStatus: status }), 'SOX')).not.toBeNull()
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  // 白名單刻意逐字比對：`After Hours`（空格）不是端點實際回過的值，是刻意挑的近似字串。
  // 端點若哪天改了寫法，要的是退回現行行為並吵一聲，不是靠模糊比對猜著放行。
  it('近似但不逐字相符的狀態字串仍拒絕', () => {
    const warn = silenceWarn()
    expect(parseNasdaqInfo(infoWithData({ marketStatus: 'After Hours' }), 'SOX')).toBeNull()
    warn.restore()
  })

  // 這一道是八道守衛裡唯一曾經不留痕跡的，而它擋下 overlay 的症狀與「修法沒生效」
  // 一模一樣——us-sox / us-nasdaq-comp 每天沿用 T-1 收盤的問題因此查了三個 session。
  // warn 必須帶**實際的 marketStatus 字串**：只印「skip overlay」等於還是不知道是哪一道、為什麼。
  it('marketStatus 被拒絕時 warn 出實際狀態字串，不靜默', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    parseNasdaqInfo(infoWithData({ marketStatus: 'After Hours' }), 'SOX')
    expect(warn).toHaveBeenCalledTimes(1)
    const msg = String(warn.mock.calls[0]?.[0] ?? '')
    expect(msg).toContain('SOX')
    expect(msg).toContain('After Hours')
    warn.mockRestore()
  })

  it('symbol 不符只 degrade、不 throw（疊加層不得拖垮已抓到的 historical）', () => {
    const warn = silenceWarn()
    expect(parseNasdaqInfo(infoWithData({ symbol: 'COMP' }), 'SOX')).toBeNull()
    expect(warn.spy).toHaveBeenCalled()
    warn.restore()
  })

  it('大小寫與前後空白不算 symbol 不符', () => {
    expect(parseNasdaqInfo(infoWithData({ symbol: ' sox ' }), 'SOX')?.date).toBe('2026-08-03')
  })

  it('data 為 null（rCode 400）只 degrade、不 throw', () => {
    const warn = silenceWarn()
    expect(parseNasdaqInfo({ data: null, status: { rCode: 400 } }, 'SOX')).toBeNull()
    warn.restore()
  })

  it.each([
    ['帶時間的變體', 'Aug 3, 2026 4:15 PM ET'],
    ['無效月份縮寫', 'Foo 3, 2026'],
    ['ISO 格式', '2026-08-03'],
    ['非真實曆日（Date 會 roll over 成 3/2）', 'Feb 30, 2026'],
    ['非字串', 12345],
  ])('lastTradeTimestamp %s 一律不採用', (_label, ts) => {
    const warn = silenceWarn()
    expect(parseNasdaqInfo(infoWith({ lastTradeTimestamp: ts }), 'SOX')).toBeNull()
    warn.restore()
  })

  it('接受真實閏日與個位數日期（曆日檢查不得誤殺）', () => {
    const point = parseNasdaqInfo(infoWith({ lastTradeTimestamp: 'Feb 29, 2024' }), 'SOX')
    expect(point?.date).toBe('2024-02-29')
  })

  // Number('') === 0 且 Number.isFinite(0) 為 true：不擋就是「0 點」印進報告。
  it.each([
    ['空字串', ''],
    ['佔位符', '--'],
    ['歐系千分位', '11.430,35'],
    ['科學記號', '1e5'],
  ])('lastSalePrice %s 一律不採用', (_label, price) => {
    const warn = silenceWarn()
    expect(parseNasdaqInfo(infoWith({ lastSalePrice: price }), 'SOX')).toBeNull()
    warn.restore()
  })

  it('netChange 無法解析時不採用（沒有前值就無從做一致性檢查）', () => {
    const warn = silenceWarn()
    expect(parseNasdaqInfo(infoWith({ netChange: '--' }), 'SOX')).toBeNull()
    warn.restore()
  })

  it('primaryData 缺席（形狀漂移）只 degrade', () => {
    const warn = silenceWarn()
    expect(parseNasdaqInfo(infoWithData({ primaryData: null }), 'SOX')).toBeNull()
    expect(warn.spy).toHaveBeenCalled()
    warn.restore()
  })
})

describe('overlayInfoPoint', () => {
  const NEWER = { date: '2026-08-03', value: 11430.35, impliedPrevClose: 11311.08 }

  it('info 較新且前值對得上 historical 最新列 → 疊上去', () => {
    expect(overlayInfoPoint(HIST_LAGGING, NEWER)).toEqual([
      { date: '2026-08-03', value: 11430.35 },
      ...HIST_LAGGING,
    ])
  })

  // 尾差要拿真的有尾差的那一組來測：SOX 的 11,430.35 − 119.27 剛好精確等於 11311.08，
  // 拿它當「浮點尾差」案例等於什麼都沒驗。COMP 的 25,913.90 − 540.05 才會漂成 …850000000002。
  const COMP_HIST = [{ date: '2026-07-31', value: 25373.85 }]
  const COMP_INFO = { date: '2026-08-03', value: 25913.90, impliedPrevClose: 25913.90 - 540.05 }

  it('真實浮點尾差不算不一致（COMP：25,913.90 − 540.05 = 25373.850000000002）', () => {
    expect(overlayInfoPoint(COMP_HIST, COMP_INFO)).toHaveLength(2)
  })

  // 容差 max(0.01, |錨點| × 1e-6) 是這次修法唯一決定「寫入 vs 不寫入」的數值旋鈕，
  // 下面三條把它釘死：改成 0、改成純絕對值、或改成一個大數，都會有測試變紅。
  // SOX 錨點 11311.08 → 容差 0.011311；COMP 錨點 25373.85 → 容差 0.025374。
  it('前值差 0.011（< SOX 容差 0.011311）→ 仍疊', () => {
    expect(overlayInfoPoint(HIST_LAGGING, { ...NEWER, impliedPrevClose: 11311.091 })).toHaveLength(3)
  })

  it('前值差 0.013（> SOX 容差 0.011311）→ 不疊', () => {
    const warn = silenceWarn()
    expect(overlayInfoPoint(HIST_LAGGING, { ...NEWER, impliedPrevClose: 11311.093 })).toEqual(HIST_LAGGING)
    warn.restore()
  })

  it('相對項不是裝飾：同樣差 0.02，SOX 該拒、COMP 該收', () => {
    const warn = silenceWarn()
    expect(overlayInfoPoint(HIST_LAGGING, { ...NEWER, impliedPrevClose: 11311.10 })).toEqual(HIST_LAGGING)
    warn.restore()
    expect(overlayInfoPoint(COMP_HIST, { ...COMP_INFO, impliedPrevClose: 25373.87 })).toHaveLength(2)
  })

  it.each([
    ['同一天（historical 已自己補齊）', '2026-07-31'],
    ['更舊（info 反而落後）', '2026-07-30'],
  ])('info 日期 %s → 原樣回傳', (_label, date) => {
    expect(overlayInfoPoint(HIST_LAGGING, { ...NEWER, date })).toEqual(HIST_LAGGING)
  })

  it('前值對不上 → degrade，不硬寫入', () => {
    const warn = silenceWarn()
    expect(overlayInfoPoint(HIST_LAGGING, { ...NEWER, impliedPrevClose: 9999 })).toEqual(HIST_LAGGING)
    expect(warn.spy).toHaveBeenCalled()
    warn.restore()
  })

  it('historical 為空 → 沒有錨點可比，不疊', () => {
    expect(overlayInfoPoint([], NEWER)).toEqual([])
  })

  // 沒有日期窗上界時，一份「價格與 netChange 都自洽、只有日期離譜」的回應會照樣通過
  // 一致性檢查，而那一點會永遠是序列的最新值。
  it('日期離譜（遠期）→ 即使前值對得上也不疊', () => {
    const warn = silenceWarn()
    expect(overlayInfoPoint(HIST_LAGGING, { ...NEWER, date: '9999-08-03' })).toEqual(HIST_LAGGING)
    expect(warn.spy).toHaveBeenCalled()
    warn.restore()
  })

  it.each([
    ['隔一個曆日（週二到週五的常態）', '2026-08-01', 3],
    ['隔三個曆日（週一補週五）', '2026-08-03', 3],
    ['隔七個曆日（上界本身＝9/11 級停市的實際天數）', '2026-08-07', 3],
    ['隔八個曆日（超過上界）', '2026-08-08', 2],
  ])('日期窗 %s → 序列長度 %s', (_label, date, expectedLength) => {
    const warn = silenceWarn()
    expect(overlayInfoPoint(HIST_LAGGING, { ...NEWER, date })).toHaveLength(expectedLength as number)
    warn.restore()
  })

  it('info 為 null → 原樣回傳', () => {
    expect(overlayInfoPoint(HIST_LAGGING, null)).toEqual(HIST_LAGGING)
  })

  // 端點回的是新到舊，但這個順序是端點的實作細節、不是契約，所以錨點要真的算 max。
  it('historical 未排序時仍以真正最新的一列當錨點', () => {
    const shuffled = [...HIST_LAGGING].reverse() // 舊到新；錨點仍該是 07-31 的 11311.08
    expect(overlayInfoPoint(shuffled, NEWER)).toHaveLength(3)
    expect(overlayInfoPoint(shuffled, { ...NEWER, impliedPrevClose: 11302.99 })).toEqual(shuffled)
  })
})

describe('fetchNasdaqSeries + /info 疊加', () => {
  const NOW = new Date('2026-08-03T22:26:00Z') // pipeline 實際跑的時刻（06:26 台北）

  const HIST_BODY_LAGGING = {
    data: {
      symbol: 'SOX',
      tradesTable: {
        rows: [
          { date: '07/31/2026', close: '11,311.08' },
          { date: '07/30/2026', close: '11,302.99' },
        ],
      },
    },
    status: { rCode: 200 },
  }

  it('historical 缺當日、info 有 → 疊上當日收盤（historical 延遲補齊事故正是這個狀態）', async () => {
    vi.stubGlobal('fetch', routedFetch(HIST_BODY_LAGGING, INFO_BODY))
    await expect(fetchNasdaqSeries(specOf('SOX'), NOW)).resolves.toEqual([
      { date: '2026-08-03', value: 11430.35 },
      { date: '2026-07-31', value: 11311.08 },
      { date: '2026-07-30', value: 11302.99 },
    ])
  })

  it('打的是 /info?assetclass=index', async () => {
    const spy = routedFetch(HIST_BODY_LAGGING, INFO_BODY)
    vi.stubGlobal('fetch', spy)
    await fetchNasdaqSeries(specOf('SOX'), NOW)
    const url = String(spy.mock.calls[1]?.[0])
    expect(url).toBe('https://api.nasdaq.com/api/quote/SOX/info?assetclass=index')
  })

  it.each([
    ['非 200', async (url: unknown) => String(url).includes('/info') ? new Response('nope', { status: 500 }) : okJson(HIST_BODY_LAGGING)],
    ['回非 JSON', async (url: unknown) => String(url).includes('/info') ? new Response('<html>', { status: 200 }) : okJson(HIST_BODY_LAGGING)],
    ['連線失敗', async (url: unknown) => {
      if (String(url).includes('/info'))
        throw new Error('ECONNRESET')
      return okJson(HIST_BODY_LAGGING)
    }],
  ])('info 端點 %s → 只回 historical，不讓整條序列失敗', async (_label, impl) => {
    vi.stubGlobal('fetch', vi.fn(impl))
    const warn = silenceWarn()
    await expect(fetchNasdaqSeries(specOf('SOX'), NOW)).resolves.toEqual([
      { date: '2026-07-31', value: 11311.08 },
      { date: '2026-07-30', value: 11302.99 },
    ])
    expect(warn.spy).toHaveBeenCalled()
    warn.restore()
  })

  it('historical 非 200 時不打 info（主體都沒了、疊加沒有意義）', async () => {
    const spy = vi.fn(async () => new Response('nope', { status: 503 }))
    vi.stubGlobal('fetch', spy)
    await expect(fetchNasdaqSeries(specOf('SOX'), NOW)).rejects.toThrow(/503/)
    expect(spy).toHaveBeenCalledTimes(1)
  })
})

// prod 曾發生「沒有任何 [nasdaq-client] 行」同時代表疊加成功與被靜默跳過的事故，
// 三個 session 都因此指認不出是哪一道守衛擋的。以下逐條釘住「每條路徑都留下可判讀的痕跡」。
describe('fetchNasdaqSeries 的疊加結果行', () => {
  const NOW = new Date('2026-08-03T22:26:00Z')

  const HIST_BODY_LAGGING = {
    data: {
      symbol: 'SOX',
      tradesTable: { rows: [{ date: '07/31/2026', close: '11,311.08' }, { date: '07/30/2026', close: '11,302.99' }] },
    },
    status: { rCode: 200 },
  }

  it('疊上去時印出 overlaid 與兩端日期', async () => {
    vi.stubGlobal('fetch', routedFetch(HIST_BODY_LAGGING, INFO_BODY))
    const log = captureLog()
    await fetchNasdaqSeries(specOf('SOX'), NOW)
    const line = log.line()
    log.restore()
    expect(line).toContain('SOX: overlay outcome')
    expect(line).toContain('historical 2 rows (latest 2026-07-31)')
    expect(line).toContain('info 2026-08-03')
    expect(line).toContain('result latest 2026-08-03')
    expect(line).toContain('→ overlaid')
  })

  // 這條路徑（info 不比序列最新列新）原本從頭到尾不印任何東西，是本次要堵的主要盲點之一。
  it('historical 已自己補齊、info 不更新時仍留痕，且不誤報成 warn', async () => {
    vi.stubGlobal('fetch', routedFetch(OK_BODY, INFO_SAME_DAY_AS_OK_BODY))
    const warn = silenceWarn()
    const log = captureLog()
    await fetchNasdaqSeries(specOf('SOX'), NOW)
    const line = log.line()
    log.restore()
    expect(warn.spy).not.toHaveBeenCalled()
    warn.restore()
    expect(line).toContain('historical 3 rows (latest 2026-07-30)')
    expect(line).toContain('info 2026-07-30')
    expect(line).toContain('→ not overlaid')
  })

  // 另一條原本靜默的路徑：查詢窗內無交易日，historical 為空所以沒有錨點可比。
  it('historical 為空時印出 0 rows', async () => {
    vi.stubGlobal('fetch', routedFetch(EMPTY_WINDOW_BODY, INFO_BODY))
    const log = captureLog()
    await fetchNasdaqSeries(specOf('SOX'), NOW)
    const line = log.line()
    log.restore()
    expect(line).toContain('historical 0 rows (latest none)')
    expect(line).toContain('result latest none')
    expect(line).toContain('→ not overlaid')
  })

  // marketStatus 這一道自己會 warn，但結果行要能一起讀出「這次沒有 info 可疊」。
  it('marketStatus 被拒絕時結果行記為 info none', async () => {
    vi.stubGlobal('fetch', routedFetch(HIST_BODY_LAGGING, infoWithData({ marketStatus: 'Open' })))
    const warn = silenceWarn()
    const log = captureLog()
    await fetchNasdaqSeries(specOf('SOX'), NOW)
    const line = log.line()
    log.restore()
    expect(warn.spy).toHaveBeenCalledWith(expect.stringContaining('marketStatus=Open'))
    warn.restore()
    expect(line).toContain('info none')
    expect(line).toContain('result latest 2026-07-31')
    expect(line).toContain('→ not overlaid')
  })

  // 沿用 T-1 事故的回歸測試，重現 2026-08-07 prod 實際發生的形狀：pipeline 落在 ET 17:53，
  // /info 已是當日最終收盤而 /historical 仍停在 T-1，`After-Hours` 卻把疊加整個擋掉，
  // 於是 us-sox / us-nasdaq-comp 每天沿用 T-1。修法後這個組合必須疊得上去。
  it('after-hours 時段仍疊上當日收盤（沿用 T-1 事故回歸）', async () => {
    vi.stubGlobal('fetch', routedFetch(HIST_BODY_LAGGING, infoWithData({ marketStatus: 'After-Hours' })))
    const log = captureLog()
    await expect(fetchNasdaqSeries(specOf('SOX'), NOW)).resolves.toEqual([
      { date: '2026-08-03', value: 11430.35 },
      { date: '2026-07-31', value: 11311.08 },
      { date: '2026-07-30', value: 11302.99 },
    ])
    const line = log.line()
    log.restore()
    expect(line).toContain('info 2026-08-03')
    expect(line).toContain('→ overlaid')
  })
})
