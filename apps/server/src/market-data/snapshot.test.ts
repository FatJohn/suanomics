import type { SeriesLatest } from './snapshot.js'
import { describe, expect, it, vi } from 'vitest'
import { SERIES_SPECS } from './series-config.js'
import { buildSnapshotBlock, displayValueOf, formatSeriesValue, resolveSeriesRenderState, selectCitableSeries, selectSeriesAnchors } from './snapshot.js'

function spec(id: string) {
  const s = SERIES_SPECS.find(x => x.seriesId === id)
  if (!s)
    throw new Error(id)
  return s
}
const NOW = new Date('2026-06-12T08:00:00Z')
// NOW 的台北曆日即 2026-06-12；reportDate 改必填後顯式帶入同一天，行為與改動前逐字相同。
const REPORT_DATE = '2026-06-12'

describe('buildSnapshotBlock', () => {
  it('renders sections with latest value + previous comparison', () => {
    const out = buildSnapshotBlock([
      { spec: spec('us-cpi-yoy'), points: [{ date: '2026-05-01', value: 3.1 }, { date: '2026-04-01', value: 3.3 }] },
      { spec: spec('us-10y-yield'), points: [{ date: '2026-06-11', value: 4.32 }, { date: '2026-06-10', value: 4.28 }] },
      { spec: spec('taiex-close'), points: [{ date: '2026-06-11', value: 23150 }] },
    ], NOW, REPORT_DATE)
    expect(out).toContain('## 市場數據（含與前期變化、各序列日期見各行、非報告當日）')
    expect(out).toContain('### 美國總經')
    expect(out).toContain('- CPI 年增率：3.1%（2026-05、前月 3.3%、較前月 -0.2 個百分點）')
    expect(out).toContain('### 利率與市場')
    expect(out).toContain('- 美債 10 年期殖利率：4.32%（2026-06-11、前值 4.28%、較前值 +0.04 個百分點）')
    expect(out).toContain('### 台股')
    expect(out).toContain('- 加權指數：23,150 點（2026-06-11）')
  })

  it('marks stale series（monthly > 45d、daily > 5d）', () => {
    const out = buildSnapshotBlock([
      { spec: spec('us-10y-yield'), points: [{ date: '2026-05-01', value: 4.1 }] },
    ], NOW, REPORT_DATE)
    expect(out).toContain('- 美債 10 年期殖利率：資料未更新')
  })

  it('omits empty sections; returns null when nothing renders', () => {
    expect(buildSnapshotBlock([], NOW, REPORT_DATE)).toBeNull()
  })

  // 以下兩條是 characterization test：釘住 renderRow 三條抑制路徑裡原本**沒有任何斷言**的兩條。
  // 沒有它們，把抑制邏輯抽成共用函式時漏掉或反轉這兩條，測試照樣全綠——而下游的
  // selectCitableSeries 會因此列出 block 沒印數字的序列，讓合法的 series ref 被 D3 判成幻覺。
  it('無點位的序列一律抑制（不印數字、不印日期）', () => {
    const out = buildSnapshotBlock([
      { spec: spec('us-10y-yield'), points: [] },
      { spec: spec('taiex-close'), points: [{ date: '2026-06-11', value: 23150 }] },
    ], NOW, REPORT_DATE)
    expect(out).toContain('- 美債 10 年期殖利率：資料未更新')
    expect(out).toContain('- 加權指數：23,150 點（2026-06-11）')
  })

  it('假日表涵蓋窗外 + 超過絕對曆日門檻 → 仍抑制（降級路徑的抑制分支）', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const out = buildSnapshotBlock(
      [{ spec: spec('us-sox'), points: [{ date: '2026-12-20', value: 5432 }] }],
      new Date('2027-01-05T05:10:00+08:00'),
      '2027-01-05',
    )
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('超出假日表涵蓋窗'))
    expect(out).toContain('- 費城半導體指數：資料未更新')
    expect(out).not.toContain('5,432')
    warnSpy.mockRestore()
  })

  // 降級路徑（假日表涵蓋窗外）的絕對曆日粗判要錨在 reportDate、不是 now。
  // 補跑舊報告時 now 是「今天」，latest.date 距 reportDate 只有 3 天（門檻內），但距
  // 「今天」可以是數十天（門檻外）——修前會被誤判成 stale、整條序列悄悄消失，而那天
  // 的資料其實是齊的。
  it('降級路徑錨在 reportDate：補跑舊報告時，距 reportDate 在門檻內就該顯示（即使距 now 已超過門檻）', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const out = buildSnapshotBlock(
      [{ spec: spec('us-sox'), points: [{ date: '2027-01-02', value: 5432 }] }],
      new Date('2027-06-01T05:10:00+08:00'), // 執行當下（補跑當天）——距 latest 已遠超 5 天門檻
      '2027-01-05', // reportDate，距 latest（2027-01-02）僅 3 天（門檻內）
    )
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('超出假日表涵蓋窗'))
    expect(out).toContain('- 費城半導體指數：5,432 點（2027-01-02）')
    warnSpy.mockRestore()
  })

  // positive control（配對上面那條）：同樣是補跑舊報告（now 遠在 reportDate 之後），
  // 但這次 latest.date 距 **reportDate** 本身也超過門檻——證明修法不是「乾脆不再抑制」，
  // 而是把比較基準換了。用同一組遠期 now，排除「reportDate 剛好等於 now」這種巧合掩蓋
  // 基準錯誤的可能（上面「假日表涵蓋窗外 + 超過絕對曆日門檻」那條 now===reportDate，
  // 無法單獨證明基準是哪一個）。
  it('降級路徑錨在 reportDate 的 positive control：距 reportDate 也超過門檻時仍抑制', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const out = buildSnapshotBlock(
      [{ spec: spec('us-sox'), points: [{ date: '2026-11-01', value: 5432 }] }],
      new Date('2027-06-01T05:10:00+08:00'), // 與上面那條同一個遠期 now
      '2027-01-05', // reportDate，距 latest（2026-11-01）65 天、遠超 5 天門檻
    )
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('超出假日表涵蓋窗'))
    expect(out).toContain('- 費城半導體指數：資料未更新')
    expect(out).not.toContain('5,432')
    warnSpy.mockRestore()
  })

  // 門檻邊界：距 reportDate 剛好等於 STALE_DAYS.daily（5 天）→ 仍顯示（`>` 不是 `>=`）。
  // 若錨點誤用 reportDate 前一天（例如疊了一天的時區/off-by-one），這裡的距離會多算
  // 一天而被誤判成超過門檻、悄悄變成抑制。
  it('降級路徑門檻邊界：距 reportDate 剛好等於 STALE_DAYS 天數 → 顯示', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const out = buildSnapshotBlock(
      [{ spec: spec('us-sox'), points: [{ date: '2027-01-05', value: 5432 }] }],
      new Date('2027-06-01T05:10:00+08:00'), // 同一組遠期 now，確保基準真的是 reportDate
      '2027-01-10', // reportDate，距 latest（2027-01-05）剛好 5 天＝STALE_DAYS.daily
    )
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('超出假日表涵蓋窗'))
    expect(out).toContain('- 費城半導體指數：5,432 點（2027-01-05）')
    warnSpy.mockRestore()
  })

  // 上一條的鄰居：距 reportDate 多一天（6 天）就要跨過門檻、抑制。
  it('降級路徑門檻邊界：距 reportDate 為 STALE_DAYS+1 天 → 抑制', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const out = buildSnapshotBlock(
      [{ spec: spec('us-sox'), points: [{ date: '2027-01-04', value: 5432 }] }],
      new Date('2027-06-01T05:10:00+08:00'),
      '2027-01-10', // reportDate，距 latest（2027-01-04）6 天＝STALE_DAYS.daily+1
    )
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('超出假日表涵蓋窗'))
    expect(out).toContain('- 費城半導體指數：資料未更新')
    expect(out).not.toContain('5,432')
    warnSpy.mockRestore()
  })

  describe('reportDate 無效時 fail-closed', () => {
    // 降級粗判的比較基準從 now 換成 reportDate 後，reportDate 若不合法
    // （undefined、空字串、'2026-13-45' 這種形狀合法但語意非法的值），calendarDaysBetween
    // 的錨點會是 Invalid Date、算出來的天數是 NaN——`NaN > STALE_DAYS[...]` 恆為 false，
    // 過舊資料反而被放行（fail-open）。這裡釘住 fail-closed：一律抑制＋出聲。
    const cases: { label: string, reportDate: unknown }[] = [
      { label: 'undefined', reportDate: undefined },
      { label: '空字串', reportDate: '' },
      { label: '形狀合法但語意非法（2026-13-45）', reportDate: '2026-13-45' },
    ]

    for (const { label, reportDate } of cases) {
      it(`resolveSeriesRenderState 對 reportDate=${label} 抑制並出聲`, () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const item = { spec: spec('us-sox'), points: [{ date: '2026-06-11', value: 5432 }] }
        const resolved = resolveSeriesRenderState(item, NOW, reportDate as string, { warnOnDegrade: true })
        expect(resolved.state).toBe('suppressed')
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('不是合法日期'))
        warnSpy.mockRestore()
      })

      it(`buildSnapshotBlock 對 reportDate=${label} 也抑制、不放行過舊資料`, () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const out = buildSnapshotBlock(
          [{ spec: spec('us-sox'), points: [{ date: '2026-06-11', value: 5432 }] }],
          NOW,
          reportDate as string,
        )
        expect(out).toContain('- 費城半導體指數：資料未更新')
        expect(out).not.toContain('5,432')
        warnSpy.mockRestore()
      })
    }
  })

  // 格式邊角：億元帶千分位 + 正號（買賣超有方向）、0 位小數
  it('formats 億元 with thousands separator and explicit sign', () => {
    const out = buildSnapshotBlock([
      { spec: spec('taiex-institutional-net'), points: [{ date: '2026-06-11', value: 505.698 }] },
    ], NOW, REPORT_DATE)
    expect(out).toContain('- 三大法人買賣超：+506 億元（2026-06-11）')
  })

  it('formats negative 億元 with minus sign', () => {
    const out = buildSnapshotBlock([
      { spec: spec('taiex-institutional-net'), points: [{ date: '2026-06-11', value: -125.4 }] },
    ], NOW, REPORT_DATE)
    expect(out).toContain('- 三大法人買賣超：-125 億元（2026-06-11）')
  })

  // 格式邊角：% 用 toFixed(2) 去尾零
  it('formats % via toFixed(2) trimming trailing zeros', () => {
    const out = buildSnapshotBlock([
      { spec: spec('us-fed-funds'), points: [{ date: '2026-05-01', value: 4.32 }] },
      { spec: spec('us-10y-yield'), points: [{ date: '2026-06-11', value: 3.10 }] },
    ], NOW, REPORT_DATE)
    expect(out).toContain('- Fed funds 利率：4.32%')
    expect(out).toContain('- 美債 10 年期殖利率：3.1%')
  })

  // 區內順序 = SERIES_SPECS 宣告順序（fed-funds 宣告在 10y 之前）
  it('orders rows within a section by SERIES_SPECS declaration order', () => {
    const out = buildSnapshotBlock([
      { spec: spec('us-10y-yield'), points: [{ date: '2026-06-11', value: 4.32 }] },
      { spec: spec('us-fed-funds'), points: [{ date: '2026-05-01', value: 4.5 }] },
    ], NOW, REPORT_DATE)
    expect(out).not.toBeNull()
    const text = out ?? ''
    expect(text.indexOf('Fed funds 利率')).toBeLessThan(text.indexOf('美債 10 年期殖利率'))
  })

  // 4 條 CPI 成分序列在美國總經區 render 出 % 格式 + yoy 前月 delta
  it('renders CPI component series under 美國總經', () => {
    const out = buildSnapshotBlock([
      { spec: spec('us-cpi-energy-yoy'), points: [{ date: '2026-05-01', value: 2.4 }, { date: '2026-04-01', value: 3.0 }] },
      { spec: spec('us-cpi-food-yoy'), points: [{ date: '2026-05-01', value: 2.9 }, { date: '2026-04-01', value: 2.8 }] },
      { spec: spec('us-cpi-shelter-yoy'), points: [{ date: '2026-05-01', value: 4.1 }, { date: '2026-04-01', value: 4.3 }] },
      { spec: spec('us-cpi-supercore-yoy'), points: [{ date: '2026-05-01', value: 3.7 }, { date: '2026-04-01', value: 3.6 }] },
    ], NOW, REPORT_DATE)
    expect(out).toContain('### 美國總經')
    expect(out).toContain('- CPI 能源年增率：2.4%（2026-05、前月 3%、較前月 -0.6 個百分點）')
    expect(out).toContain('- CPI 食物年增率：2.9%（2026-05、前月 2.8%、較前月 +0.1 個百分點）')
    expect(out).toContain('- CPI 房租年增率：4.1%（2026-05、前月 4.3%、較前月 -0.2 個百分點）')
    expect(out).toContain('- CPI 核心服務年增率：3.7%（2026-05、前月 3.6%、較前月 +0.1 個百分點）')
  })

  // 美股指數獨立成「美股」區（as-of 是美國交易日、與台股/月頻語意不同）。
  // 數值取 2026-07-30 實測收盤，delta 即當初漏掉的那個 +8.19%。
  it('renders 美股 section with the two Nasdaq index series', () => {
    const out = buildSnapshotBlock([
      { spec: spec('us-sox'), points: [{ date: '2026-07-30', value: 11302.99 }, { date: '2026-07-29', value: 10447.49 }] },
      { spec: spec('us-nasdaq-comp'), points: [{ date: '2026-07-30', value: 25122.18 }, { date: '2026-07-29', value: 24500.05 }] },
    ], new Date('2026-07-31T00:00:00Z'), '2026-07-31')
    expect(out).toContain('### 美股')
    expect(out).toContain('- 費城半導體指數：11,303 點（2026-07-30、前值 10,447 點、+856 點 / +8.19%）')
    expect(out).toContain('- 納斯達克綜合指數：25,122 點（2026-07-30、前值 24,500 點、+622 點 / +2.54%）')
  })

  // 美股區排在利率與市場之後、台股之前（兩個股市相鄰、方便寫美台連動）。
  it('orders 美股 between 利率與市場 and 台股', () => {
    const out = buildSnapshotBlock([
      { spec: spec('taiex-close'), points: [{ date: '2026-07-30', value: 23150 }] },
      { spec: spec('us-sox'), points: [{ date: '2026-07-30', value: 11302.99 }] },
      { spec: spec('us-10y-yield'), points: [{ date: '2026-07-30', value: 4.32 }] },
    ], new Date('2026-07-31T00:00:00Z'), '2026-07-31')
    const order = ['### 利率與市場', '### 美股', '### 台股'].map(h => out?.indexOf(h) ?? -1)
    expect(order.every(i => i >= 0)).toBe(true)
    expect(order).toEqual([...order].sort((a, b) => a - b))
  })

  // 外資台指期淨部位 口 單位(signed 千分位) + FLOW net-position 方向語
  it('renders 外資台指期淨部位 with 口 unit and 持續淨空 phrase', () => {
    const out = buildSnapshotBlock([
      { spec: spec('foreign-taifex-net'), points: [{ date: '2026-07-07', value: -80042 }, { date: '2026-07-06', value: -80087 }] },
    ], new Date('2026-07-08T08:00:00Z'), '2026-07-08')
    expect(out).toContain('### 台股')
    expect(out).toContain('- 外資台指期淨部位：-80,042 口（2026-07-07、前值 -80,087 口、持續淨空）')
  })

  it('renders 由淨空轉淨多 phrase when net position flips sign', () => {
    const out = buildSnapshotBlock([
      { spec: spec('foreign-taifex-net'), points: [{ date: '2026-07-07', value: 5000 }, { date: '2026-07-06', value: -3000 }] },
    ], new Date('2026-07-08T08:00:00Z'), '2026-07-08')
    expect(out).toContain('- 外資台指期淨部位：+5,000 口（2026-07-07、前值 -3,000 口、由淨空轉淨多）')
  })

  it('renders 持續淨多 phrase when both values positive', () => {
    const out = buildSnapshotBlock([
      { spec: spec('foreign-taifex-net'), points: [{ date: '2026-07-07', value: 50000 }, { date: '2026-07-06', value: 30000 }] },
    ], new Date('2026-07-08T08:00:00Z'), '2026-07-08')
    expect(out).toContain('- 外資台指期淨部位：+50,000 口（2026-07-07、前值 +30,000 口、持續淨多）')
  })

  it('renders 由淨多轉淨空 phrase when net position flips from positive to negative', () => {
    const out = buildSnapshotBlock([
      { spec: spec('foreign-taifex-net'), points: [{ date: '2026-07-07', value: -20000 }, { date: '2026-07-06', value: 10000 }] },
    ], new Date('2026-07-08T08:00:00Z'), '2026-07-08')
    expect(out).toContain('- 外資台指期淨部位：-20,000 口（2026-07-07、前值 +10,000 口、由淨多轉淨空）')
  })

  // 借券賣出餘額 億股 單位（2 位小數去尾零、無正負號、存量走水準值 delta）
  it('renders 借券賣出餘額 with 億股 unit and level delta', () => {
    const out = buildSnapshotBlock([
      { spec: spec('taiex-sbl-balance'), points: [{ date: '2026-07-09', value: 179.64 }, { date: '2026-07-08', value: 179.47 }] },
    ], new Date('2026-07-10T08:00:00Z'), '2026-07-10')
    expect(out).toContain('### 台股')
    expect(out).toContain('- 借券賣出餘額：179.64 億股（2026-07-09、前值 179.47 億股、+0.17 億股 / +0.09%）')
  })

  it('formats 億股 trailing zeros trimmed and unsigned', () => {
    const out = buildSnapshotBlock([
      { spec: spec('taiex-sbl-balance'), points: [{ date: '2026-07-09', value: 180 }] },
    ], new Date('2026-07-10T08:00:00Z'), '2026-07-10')
    expect(out).toContain('- 借券賣出餘額：180 億股（2026-07-09）')
    expect(out).not.toContain('+180')
  })

  // ≥1000 億股 需帶千分位（整數部分）、保留小數
  it('formats 億股 ≥1000 with thousands separator', () => {
    const out = buildSnapshotBlock([
      { spec: spec('taiex-sbl-balance'), points: [{ date: '2026-07-09', value: 1234.5 }] },
    ], new Date('2026-07-10T08:00:00Z'), '2026-07-10')
    expect(out).toContain('- 借券賣出餘額：1,234.5 億股（2026-07-09）')
  })

  // 融券餘額 張 單位（千分位、無正負號、存量走水準值 delta）
  it('renders 融券餘額 with 張 unit and level delta', () => {
    const out = buildSnapshotBlock([
      { spec: spec('taiex-margin-short-balance'), points: [{ date: '2026-07-09', value: 203714 }, { date: '2026-07-08', value: 200000 }] },
    ], new Date('2026-07-10T08:00:00Z'), '2026-07-10')
    expect(out).toContain('### 台股')
    expect(out).toContain('- 融券餘額：203,714 張（2026-07-09、前值 200,000 張、+3,714 張 / +1.86%）')
  })

  it('formats 張 unsigned (存量、無前導正負號)', () => {
    const out = buildSnapshotBlock([
      { spec: spec('taiex-margin-short-balance'), points: [{ date: '2026-07-09', value: 203714 }] },
    ], new Date('2026-07-10T08:00:00Z'), '2026-07-10')
    expect(out).toContain('- 融券餘額：203,714 張（2026-07-09）')
    expect(out).not.toContain('+203,714')
  })

  // 全文契約：三區各至少 1 條（含一條過舊、一條帶前期比較）、把 ## 標題 / ### 階層 /
  // 空行 / 行序整塊釘死。這串是給 LLM 的 prompt 契約、結構若被小改動悄悄破壞、此測試先紅。
  it('pins the full block structure (LLM prompt contract)', () => {
    const out = buildSnapshotBlock([
      // us-macro：帶前月比較 + 過舊（失業率 2026-02 落後期望 3 個月、達硬上限）
      { spec: spec('us-cpi-yoy'), points: [{ date: '2026-05-01', value: 3.1 }, { date: '2026-04-01', value: 3.3 }] },
      { spec: spec('us-unemployment'), points: [{ date: '2026-02-01', value: 4.0 }] },
      // rates-markets：daily 帶前值
      { spec: spec('us-10y-yield'), points: [{ date: '2026-06-11', value: 4.32 }, { date: '2026-06-10', value: 4.28 }] },
      // us-equity：落後 1 個交易日（靜默沿用 T-1 時的標注格式）
      { spec: spec('us-sox'), points: [{ date: '2026-06-10', value: 5432 }] },
      // taiwan：億元帶正號 + 加權指數
      { spec: spec('taiex-close'), points: [{ date: '2026-06-11', value: 23150 }] },
      { spec: spec('taiex-institutional-net'), points: [{ date: '2026-06-11', value: 505.698 }] },
    ], NOW, REPORT_DATE)
    expect(out).toMatchInlineSnapshot(`
      "## 市場數據（含與前期變化、各序列日期見各行、非報告當日）

      ### 美國總經
      - CPI 年增率：3.1%（2026-05、前月 3.3%、較前月 -0.2 個百分點）
      - 失業率：資料未更新（最新僅到 2026-02）

      ### 利率與市場
      - 美債 10 年期殖利率：4.32%（2026-06-11、前值 4.28%、較前值 +0.04 個百分點）

      ### 美股
      - 費城半導體指數：5,432 點（2026-06-10、落後 1 個交易日）

      ### 台股
      - 加權指數：23,150 點（2026-06-11）
      - 三大法人買賣超：+506 億元（2026-06-11）"
    `)
  })
})

describe('變化描述（delta）', () => {
  const now = new Date('2026-06-12T00:00:00Z')

  function latestOf(seriesId: string, points: { date: string, value: number }[]): SeriesLatest {
    const spec = SERIES_SPECS.find(s => s.seriesId === seriesId)
    if (!spec)
      throw new Error(`unknown series ${seriesId}`)
    return { spec, points }
  }

  it('% 序列附百分點差（monthly 用「較前月」）', () => {
    const block = buildSnapshotBlock([latestOf('us-cpi-yoy', [
      { date: '2026-05-01', value: 4.2 },
      { date: '2026-04-01', value: 3.9 },
    ])], now, '2026-06-12')
    expect(block).toContain('- CPI 年增率：4.2%（2026-05、前月 3.9%、較前月 +0.3 個百分點）')
  })

  it('% 序列 daily 用「較前值」、變化為負', () => {
    const block = buildSnapshotBlock([latestOf('us-10y-yield', [
      { date: '2026-06-11', value: 4.4 },
      { date: '2026-06-10', value: 4.45 },
    ])], now, '2026-06-12')
    expect(block).toContain('較前值 -0.05 個百分點')
  })

  it('% 序列無變化 → 持平', () => {
    const block = buildSnapshotBlock([latestOf('us-unemployment', [
      { date: '2026-05-01', value: 4.1 },
      { date: '2026-04-01', value: 4.1 },
    ])], now, '2026-06-12')
    expect(block).toContain('與前月持平')
  })

  it('點 序列附差值與變動%', () => {
    const block = buildSnapshotBlock([latestOf('taiex-close', [
      { date: '2026-06-11', value: 23150 },
      { date: '2026-06-10', value: 22890 },
    ])], now, '2026-06-12')
    expect(block).toContain('- 加權指數：23,150 點（2026-06-11、前值 22,890 點、+260 點 / +1.14%）')
  })

  it('美元 序列差值為負、兩位小數', () => {
    const block = buildSnapshotBlock([latestOf('wti-oil', [
      { date: '2026-06-11', value: 79.48 },
      { date: '2026-06-10', value: 80 },
    ])], now, '2026-06-12')
    expect(block).toContain('-0.52美元 / -0.65%')
  })

  it('三大法人買賣超：轉向語意（由賣轉買）', () => {
    const block = buildSnapshotBlock([latestOf('taiex-institutional-net', [
      { date: '2026-06-11', value: 120 },
      { date: '2026-06-10', value: -85 },
    ])], now, '2026-06-12')
    expect(block).toContain('- 三大法人買賣超：+120 億元（2026-06-11、前值 -85 億元、由賣轉買）')
  })

  it('三大法人買賣超：連續同向（連續買超）', () => {
    const block = buildSnapshotBlock([latestOf('taiex-institutional-net', [
      { date: '2026-06-11', value: 120 },
      { date: '2026-06-10', value: 80 },
    ])], now, '2026-06-12')
    expect(block).toContain('連續買超')
  })

  it('非農就業：由增轉減', () => {
    const block = buildSnapshotBlock([latestOf('us-nonfarm-payrolls', [
      { date: '2026-05-01', value: -20 },
      { date: '2026-04-01', value: 30 },
    ])], now, '2026-06-12')
    expect(block).toContain('由增轉減')
  })

  it('流量序列任一值為 0 → 省略 delta 語意', () => {
    const block = buildSnapshotBlock([latestOf('taiex-institutional-net', [
      { date: '2026-06-11', value: 0 },
      { date: '2026-06-10', value: 80 },
    ])], now, '2026-06-12')
    expect(block).toContain('- 三大法人買賣超：+0 億元（2026-06-11、前值 +80 億元）')
  })

  it('flow 序列 id 必須存在於 SERIES_SPECS（FLOW_PHRASES 防 rename 失聯）', () => {
    for (const id of ['taiex-institutional-net', 'us-nonfarm-payrolls'])
      expect(SERIES_SPECS.some(s => s.seriesId === id)).toBe(true)
  })

  it('融資餘額（存量）走差值規則、不用轉向語意', () => {
    const block = buildSnapshotBlock([latestOf('taiex-margin-balance', [
      { date: '2026-06-11', value: 2825 },
      { date: '2026-06-10', value: 2800 },
    ])], now, '2026-06-12')
    expect(block).toContain('+25 億元 / +0.89%')
    expect(block).not.toContain('連續')
  })

  // 正負號應由序列的 flow/level 語意決定、不是由 unit 推。「億元」同時被
  // 三大法人買賣超（flow、值本身帶方向）與融資餘額（level、存量）使用，用 unit 判必然錯一邊。
  it('融資餘額（level）的當期值不得帶前導正號', () => {
    const block = buildSnapshotBlock([latestOf('taiex-margin-balance', [
      { date: '2026-06-11', value: 2825 },
      { date: '2026-06-10', value: 2800 },
    ])], now, '2026-06-12')
    expect(block).toContain('融資餘額：2,825 億元')
    expect(block).not.toContain('+2,825 億元')
    // 前值也是存量、同樣不帶正號；只有 delta（+25 億元 / +0.89%）才是帶方向的量。
    expect(block).toContain('- 融資餘額：2,825 億元（2026-06-11、前值 2,800 億元、+25 億元 / +0.89%）')
  })

  // review 揭露的既有缺陷（非這次改動造成、但被順手修掉）：level 走 sign='' + Math.abs()
  // 會把負值靜默寫成正的。今日的 level 序列都不會為負，所以沒出事——那是資料湊巧、
  // 不是設計。融券餘額拿來當代表：它是 level，但格式化不該吃掉負號。
  it('level 序列為負值時仍保留負號（不因 kind=level 就吃掉符號）', () => {
    const out = buildSnapshotBlock([
      { spec: spec('taiex-margin-short-balance'), points: [{ date: '2026-07-09', value: -1234 }] },
    ], new Date('2026-07-10T08:00:00Z'), '2026-07-10')
    expect(out).toContain('- 融券餘額：-1,234 張')
  })

  it('三大法人買賣超（flow）的當期值仍要帶正負號', () => {
    const block = buildSnapshotBlock([latestOf('taiex-institutional-net', [
      { date: '2026-06-11', value: 185 },
      { date: '2026-06-10', value: 120 },
    ])], now, '2026-06-12')
    expect(block).toContain('三大法人買賣超：+185 億元')
  })

  it('無前值 → 維持原格式、無 delta', () => {
    const block = buildSnapshotBlock([latestOf('us-cpi-yoy', [
      { date: '2026-05-01', value: 4.2 },
    ])], now, '2026-06-12')
    expect(block).toContain('- CPI 年增率：4.2%（2026-05）')
  })

  it('區塊標題含「含與前期變化」', () => {
    const block = buildSnapshotBlock([latestOf('us-cpi-yoy', [
      { date: '2026-05-01', value: 4.2 },
    ])], now, '2026-06-12')
    expect(block).toContain('## 市場數據（含與前期變化、各序列日期見各行、非報告當日）')
  })
})

describe('snapshot 表頭日期中性', () => {
  it('表頭日期中性、不含「今日市場數據」字樣', () => {
    const block = buildSnapshotBlock(
      [{ spec: spec('taiex-close'), points: [{ date: '2026-06-26', value: 23150 }] }],
      new Date('2026-06-27T00:00:00Z'),
      '2026-06-27',
    )
    expect(block).not.toContain('今日市場數據')
    expect(block).toContain('市場數據')
  })
})

// 回歸：舊的絕對曆日門檻（monthly 45／daily 5）在 2026-07-31 把 26 行裡的 12 行
// 判成「資料未更新」——整個美國總經區塊都空掉、M2 因 57 天發布落差結構上永遠不可見。
// 下面這組日期是當天對 prod /api/market/snapshot 與 FRED API 的實測值。
// 它們全都是「準時發布」的狀態，改判後一行都不該消失。
describe('q3b 回歸：準時發布的序列不再被誤判為過舊', () => {
  const REAL_LATEST: Record<string, string> = {
    'us-cpi-yoy': '2026-06-01',
    'us-core-cpi-yoy': '2026-06-01',
    'us-cpi-energy-yoy': '2026-06-01',
    'us-cpi-food-yoy': '2026-06-01',
    'us-cpi-shelter-yoy': '2026-06-01',
    'us-cpi-supercore-yoy': '2026-06-01',
    'us-nonfarm-payrolls': '2026-06-01',
    'us-unemployment': '2026-06-01',
    'us-m2-yoy': '2026-06-01',
    'us-fed-funds': '2026-06-01',
    'us-10y-yield': '2026-07-29',
    'us-2y-yield': '2026-07-29',
    'us-10y-real-rate': '2026-07-29',
    'us-10y-breakeven': '2026-07-30',
    'us-yield-spread-10y2y': '2026-07-29',
    'usd-index': '2026-07-24',
    'wti-oil': '2026-07-27',
    'us-sox': '2026-07-30',
    'us-nasdaq-comp': '2026-07-30',
    'usd-twd': '2026-07-24',
    'taiex-close': '2026-07-30',
    'taiex-institutional-net': '2026-07-30',
    'taiex-margin-balance': '2026-07-30',
    'foreign-taifex-net': '2026-07-30',
    'taiex-sbl-balance': '2026-07-30',
    'taiex-margin-short-balance': '2026-07-30',
  }

  function realWorldBlock(reportDate: string): string {
    const latest: SeriesLatest[] = SERIES_SPECS.map(s => ({
      spec: s,
      points: [{ date: REAL_LATEST[s.seriesId] ?? '2026-07-30', value: 100 }],
    }))
    return buildSnapshotBlock(latest, new Date(`${reportDate}T05:10:00+08:00`), reportDate) ?? ''
  }

  it('2026-07-31（週五）：零行「資料未更新」、零行帶落後標注', () => {
    const block = realWorldBlock('2026-07-31')
    expect(block.split('\n').filter(l => l.includes('資料未更新'))).toEqual([])
    expect(block.split('\n').filter(l => l.includes('落後'))).toEqual([])
  })

  it('2026-08-03（週一）：WTI 與外匯照樣在（舊門檻在這天會多殺一行）', () => {
    const block = realWorldBlock('2026-08-03')
    expect(block).toContain('WTI 原油：')
    expect(block).toContain('美元兌台幣：')
    expect(block.split('\n').filter(l => l.includes('資料未更新'))).toEqual([])
  })

  it('每條序列都在區塊裡出現（26 條、無漏排）', () => {
    const block = realWorldBlock('2026-07-31')
    for (const s of SERIES_SPECS)
      expect(block).toContain(`- ${s.displayName}：`)
  })
})

describe('q3b 守衛：freshness 設定的完整性', () => {
  it('每條序列都有 freshness（型別已擋、此處防 as 繞過）', () => {
    for (const s of SERIES_SPECS) {
      expect(s.freshness, s.seriesId).toBeDefined()
      expect(['trading-daily', 'weekly', 'monthly']).toContain(s.freshness.cadence)
    }
  })

  it('weekly 的覆蓋終點必為工作日（週一發蓋到週五、週三發蓋到週一）', () => {
    for (const s of SERIES_SPECS) {
      if (s.freshness.cadence !== 'weekly')
        continue
      const dow = ((s.freshness.releaseDow - s.freshness.coverageLagDays) % 7 + 7) % 7
      expect(dow, `${s.seriesId} 的覆蓋終點落在週末`).toBeGreaterThanOrEqual(1)
      expect(dow, `${s.seriesId} 的覆蓋終點落在週末`).toBeLessThanOrEqual(5)
    }
  })
})

describe('q3b 降級：假日表涵蓋窗外', () => {
  it('warn 出聲並退回舊的絕對曆日粗判（症狀與要修的 bug 同形、不能無聲）', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const out = buildSnapshotBlock(
      [{ spec: spec('us-sox'), points: [{ date: '2027-01-04', value: 5432 }] }],
      new Date('2027-01-05T05:10:00+08:00'),
      '2027-01-05',
    )
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('超出假日表涵蓋窗'))
    // 涵蓋窗外仍在曆日門檻內 → 數字照給、但不帶落後標注（期望值算不出來）
    expect(out).toContain('- 費城半導體指數：5,432 點（2027-01-04）')
    expect(out).not.toContain('落後')
    warnSpy.mockRestore()
  })
})

// 把已經算好的跨市場訊號一致性事實接進快照。
// 缺口是「算得出來但沒有任何地方呼叫它」——現況仍是 prompt 叫 LLM 自己挑序列、自己判方向。
describe('跨市場訊號一致性小節', () => {
  // foreign-flow 組：台幣走貶（usd-twd 上升、極性 -1）＝資金流出側；
  // 三大法人賣超與外資期貨淨空增加（flow 為負）同樣落在流出側 → 三項全數同向。
  const FOREIGN_FLOW_ALIGNED: SeriesLatest[] = [
    { spec: spec('usd-twd'), points: [{ date: '2026-06-11', value: 32.5 }, { date: '2026-06-10', value: 32.1 }] },
    { spec: spec('taiex-institutional-net'), points: [{ date: '2026-06-11', value: -120 }, { date: '2026-06-10', value: -80 }] },
    { spec: spec('foreign-taifex-net'), points: [{ date: '2026-06-11', value: -15000 }, { date: '2026-06-10', value: -12000 }] },
  ]

  it('有訊號時輸出小節與事實句', () => {
    const out = buildSnapshotBlock(FOREIGN_FLOW_ALIGNED, NOW, REPORT_DATE)
    expect(out).toContain('### 跨市場訊號一致性')
    expect(out).toContain('外資動向：3 項訊號全數指向資金流出台股')
  })

  it('沒有訊號時整個小節不出現（不留空標題）', () => {
    const out = buildSnapshotBlock([
      { spec: spec('taiex-close'), points: [{ date: '2026-06-11', value: 23150 }] },
    ], NOW, REPORT_DATE)
    expect(out).not.toContain('### 跨市場訊號一致性')
  })

  // 引導句只描述「這是算好的事實」，不得暗示方向結論——本 issue 的 compliance 邊界。
  it('小節文字不含方向結論措辭', () => {
    const out = buildSnapshotBlock(FOREIGN_FLOW_ALIGNED, NOW, REPORT_DATE) ?? ''
    for (const banned of ['偏多', '偏空', '可信度', '開高走低', '布局', '看好', '看壞'])
      expect(out, `不該出現「${banned}」`).not.toContain(banned)
  })

  // 訊號是快照的加值資料，算爆了不該把整份市場數據一起帶走。
  it('訊號計算丟例外時，既有快照照常產出', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const out = buildSnapshotBlock(FOREIGN_FLOW_ALIGNED, NOW, REPORT_DATE, {
      computeSignals: () => {
        throw new Error('boom')
      },
    })
    expect(out).toContain('### 台股')
    expect(out).not.toContain('### 跨市場訊號一致性')
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})

// series evidenceRef 需要 seriesId + asOf，而共用的快照 block 只印 displayName。
// 這組測試釘住的是**清單與 block 的一致性**——清單列了 block 沒印的序列，模型就會引用一個
// 快照裡不存在的數字，D3 會把那個合法意圖判成幻覺。
describe('selectCitableSeries', () => {
  const MIXED: SeriesLatest[] = [
    { spec: spec('taiex-close'), points: [{ date: '2026-06-11', value: 23150 }] },
    { spec: spec('us-10y-yield'), points: [] },
    { spec: spec('us-cpi-yoy'), points: [{ date: '2026-01-01', value: 3.1 }] },
  ]

  it('列出的集合與 block 印出數字的集合完全相等（雙向）', () => {
    const block = buildSnapshotBlock(MIXED, NOW, REPORT_DATE) ?? ''
    const shown = MIXED
      .filter(i => !block.includes(`- ${i.spec.displayName}：資料未更新`))
      .map(i => i.spec.seriesId)
    const citable = selectCitableSeries(MIXED, NOW, REPORT_DATE).map(c => c.seriesId)
    expect(citable.slice().sort()).toEqual(shown.slice().sort())
    expect(citable).toEqual(['taiex-close'])
  })

  it('asOf 取該序列實際的最新日期、不是報告日', () => {
    const out = selectCitableSeries(MIXED, NOW, REPORT_DATE)
    expect(out[0]).toEqual({ seriesId: 'taiex-close', displayName: '加權指數', asOf: '2026-06-11' })
  })

  it('假日表窗外且超過曆日門檻的序列不列入，且不重複發出降級 warn', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const out = selectCitableSeries(
      [{ spec: spec('us-sox'), points: [{ date: '2026-12-20', value: 5432 }] }],
      new Date('2027-01-05T05:10:00+08:00'),
      '2027-01-05',
    )
    expect(out).toEqual([])
    // warn 屬渲染路徑（buildSnapshotBlock）的職責；清單路徑再叫一次等於同一次載入警告兩次
    expect(warnSpy).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('輸出順序為 SERIES_SPECS 宣告序（與 block 區內順序同一套、不受傳入順序影響）', () => {
    const reversed: SeriesLatest[] = [
      { spec: spec('taiex-close'), points: [{ date: '2026-06-11', value: 23150 }] },
      { spec: spec('us-10y-yield'), points: [{ date: '2026-06-11', value: 4.32 }] },
    ]
    const ids = selectCitableSeries(reversed, NOW, REPORT_DATE).map(c => c.seriesId)
    const byDeclaration = [...ids].sort(
      (a, b) => SERIES_SPECS.findIndex(s => s.seriesId === a) - SERIES_SPECS.findIndex(s => s.seriesId === b),
    )
    expect(ids).toEqual(byDeclaration)
  })
})

describe('displayValueOf 與 formatSeriesValue 的單一真相', () => {
  // 從 formatter 的輸出把數字解析回來：去千分位、去單位詞、保留正負號。
  function parseRendered(s: string): number {
    const m = /-?\d+(?:\.\d+)?/.exec(s.replace(/,/g, ''))
    if (!m)
      throw new Error(`解析不出數字：${s}`)
    return Number(m[0]) + 0 // +0 把 -0 正規化成 0，否則 toBe 的 Object.is 語意會誤紅
  }

  // 刻意含會觸發四捨五入的值（10447.49 就是費半那個真實案例）。
  const VALUES = [10447.49, 24500.05, 4.325, 1234.567, 0, -120.6, -15000]

  it('every series spec: 解析 formatSeriesValue 的輸出 === displayValueOf', () => {
    for (const s of SERIES_SPECS) {
      for (const v of VALUES) {
        expect(
          parseRendered(formatSeriesValue(v, s)),
          `${s.seriesId}（${s.unit}）value=${v} → "${formatSeriesValue(v, s)}"`,
        ).toBe(displayValueOf(v, s) + 0)
      }
    }
  })

  it('covers every unit in SERIES_SPECS（新增 unit 沒被涵蓋就紅）', () => {
    const units = new Set(SERIES_SPECS.map(s => s.unit))
    expect(units.size).toBeGreaterThanOrEqual(7)
    for (const u of units)
      expect(SERIES_SPECS.some(s => s.unit === u)).toBe(true)
  })

  it('費半那個真實案例：原值 10447.49 顯示成 10,447 點', () => {
    const sox = spec('us-sox')
    expect(formatSeriesValue(10447.49, sox)).toBe('10,447 點')
    expect(displayValueOf(10447.49, sox)).toBe(10447)
  })
})

describe('selectSeriesAnchors', () => {
  const LATEST: SeriesLatest[] = [
    { spec: spec('us-sox'), points: [{ date: '2026-06-11', value: 10447.49 }, { date: '2026-06-10', value: 10910.2 }] },
    { spec: spec('taiex-close'), points: [{ date: '2026-06-11', value: 23150 }] },
  ]

  it('emits the latest and the previous point, each with its own as-of', () => {
    expect(selectSeriesAnchors(LATEST, NOW, '2026-06-12')).toEqual([
      { seriesId: 'us-sox', displayName: '費城半導體指數', asOf: '2026-06-11', value: 10447.49, displayValue: 10447 },
      { seriesId: 'us-sox', displayName: '費城半導體指數', asOf: '2026-06-10', value: 10910.2, displayValue: 10910 },
      { seriesId: 'taiex-close', displayName: '加權指數', asOf: '2026-06-11', value: 23150, displayValue: 23150 },
    ])
  })

  it('omits series the block suppresses（與 citable 清單同一套判斷）', () => {
    const stale: SeriesLatest[] = [{ spec: spec('us-10y-yield'), points: [{ date: '2026-05-01', value: 4.1 }] }]
    expect(selectSeriesAnchors(stale, NOW, '2026-06-12')).toEqual([])
    expect(selectCitableSeries(stale, NOW, '2026-06-12')).toEqual([])
  })

  it('never leaks the previous point into the prompt list', () => {
    expect(selectCitableSeries(LATEST, NOW, '2026-06-12').map(c => c.asOf)).toEqual(['2026-06-11', '2026-06-11'])
  })
})
