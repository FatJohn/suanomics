import type { FreshnessRule } from '@suanomics/shared'

export type SeriesTransform = 'level' | 'yoy' | 'mom-diff' | 'spread'
// us-equity 獨立於 rates-markets：美股序列的日期是**美國**交易日（對台北早報＝昨夜），
// 與台股「前一交易日」、月頻總經「上月」的 as-of 語意不同，分區才不會讓 LLM 混用日期。
export type SeriesSection = 'us-macro' | 'rates-markets' | 'us-equity' | 'taiwan'
export type SeriesKind = 'level' | 'flow'

export interface SeriesSpec {
  seriesId: string
  source: 'fred' | 'twse' | 'derived' | 'taifex' | 'nasdaq'
  sourceCode: string // FRED series id / TWSE dataset path / TAIFEX commodityId / Nasdaq symbol / derived: ''
  displayName: string
  unit: '%' | '美元' | '元' | '點' | '億元' | '千人' | '口' | '億股' | '張'
  frequency: 'daily' | 'monthly'
  transform: SeriesTransform
  section: SeriesSection
  /**
   * 這個欄位問的是**「值本身帶不帶方向」**，不是嚴格的經濟學 flow/stock 分類：
   * - level：讀者只關心水準（融資餘額、殖利率、指數點位）——顯示不帶正負號。
   * - flow：值的正負本身就是資訊（買賣超、月變動、淨部位）——顯示帶正負號。
   *
   * 唯一需要留意的例外：`foreign-taifex-net`（外資台指期淨部位）嚴格說是 signed
   * **stock**（某時點的未平倉口數），但正負代表淨多/淨空、顯示語意與 flow 相同，
   * 故標 flow。若日後有用途真的需要區分 stock 與 flow，那要另加欄位、不要改這個。
   *
   * 這是顯示語意的單一真相；不要再用 unit 推論——「億元」同時被三大法人買賣超
   * （flow）與融資餘額（level）使用，用 unit 判必然錯一邊。
   * 必填無預設：新增序列漏標時由 compiler 擋下。
   */
  kind: SeriesKind
  /**
   * 這條序列「此刻應該有哪一天的資料」怎麼算。必填無預設：新增序列漏標時 compiler 擋下。
   *
   * 值必須來自對來源發布日曆的**實測**、不可由 source 或 frequency 推——同屬 FRED
   * 「每營業日發布」的 H.15，DGS10 內容落後 1 個營業日、T10YIE 落後 0。
   */
  freshness: FreshnessRule
  spreadOf?: [string, string]
}

// 發布節奏（2026-07-31 對 FRED release 日曆／各交易所實測）
const US_TRADING_T1: FreshnessRule = { cadence: 'trading-daily', market: 'us', lagTradingDays: 1 }
const US_TRADING_T2: FreshnessRule = { cadence: 'trading-daily', market: 'us', lagTradingDays: 2 }
const TW_TRADING_T1: FreshnessRule = { cadence: 'trading-daily', market: 'tw', lagTradingDays: 1 }
// H.10 Foreign Exchange Rates：每週一發布、內容蓋到前一個週五
const FRED_H10_WEEKLY: FreshnessRule = { cadence: 'weekly', releaseDow: 1, coverageLagDays: 3 }
// Spot Prices（WTI）：每週三發布、內容蓋到前一個週一
const FRED_SPOT_WEEKLY: FreshnessRule = { cadence: 'weekly', releaseDow: 3, coverageLagDays: 2 }
// 月頻的值＝參考月結束後幾天可得，取實測發布日的保守上界（估早會天天誤標、估晚只延後察覺）。
// CPI 實測 06 月數據於 07-14 發（月底後 14 天）、取 15。
const CPI_MONTHLY: FreshnessRule = { cadence: 'monthly', releaseDaysAfterMonthEnd: 15 }
// 非農實測 06 月數據於 07-02 發（月底後 2 天、當週因假日提前）；常態是次月第一個週五 → 取 7。
const BLS_EMPLOYMENT_MONTHLY: FreshnessRule = { cadence: 'monthly', releaseDaysAfterMonthEnd: 7 }
// M2（H.6）實測 06 月數據於 07-28 發（月底後 28 天）、取 29。
const M2_MONTHLY: FreshnessRule = { cadence: 'monthly', releaseDaysAfterMonthEnd: 29 }
// Fed funds 月均值（H.15）實測 06 月數據於 07-01 發（月底後 1 天）、取 3 讓開週末。
const FED_FUNDS_MONTHLY: FreshnessRule = { cadence: 'monthly', releaseDaysAfterMonthEnd: 3 }

export const SERIES_SPECS: SeriesSpec[] = [
  { seriesId: 'us-cpi-yoy', source: 'fred', sourceCode: 'CPIAUCSL', displayName: 'CPI 年增率', unit: '%', frequency: 'monthly', transform: 'yoy', section: 'us-macro', kind: 'level', freshness: CPI_MONTHLY },
  { seriesId: 'us-core-cpi-yoy', source: 'fred', sourceCode: 'CPILFESL', displayName: '核心 CPI 年增率', unit: '%', frequency: 'monthly', transform: 'yoy', section: 'us-macro', kind: 'level', freshness: CPI_MONTHLY },
  { seriesId: 'us-cpi-energy-yoy', source: 'fred', sourceCode: 'CPIENGSL', displayName: 'CPI 能源年增率', unit: '%', frequency: 'monthly', transform: 'yoy', section: 'us-macro', kind: 'level', freshness: CPI_MONTHLY },
  { seriesId: 'us-cpi-food-yoy', source: 'fred', sourceCode: 'CPIUFDSL', displayName: 'CPI 食物年增率', unit: '%', frequency: 'monthly', transform: 'yoy', section: 'us-macro', kind: 'level', freshness: CPI_MONTHLY },
  { seriesId: 'us-cpi-shelter-yoy', source: 'fred', sourceCode: 'CUSR0000SAH1', displayName: 'CPI 房租年增率', unit: '%', frequency: 'monthly', transform: 'yoy', section: 'us-macro', kind: 'level', freshness: CPI_MONTHLY },
  { seriesId: 'us-cpi-supercore-yoy', source: 'fred', sourceCode: 'CUSR0000SASL2RS', displayName: 'CPI 核心服務年增率', unit: '%', frequency: 'monthly', transform: 'yoy', section: 'us-macro', kind: 'level', freshness: CPI_MONTHLY },
  { seriesId: 'us-nonfarm-payrolls', source: 'fred', sourceCode: 'PAYEMS', displayName: '非農就業月變動', unit: '千人', frequency: 'monthly', transform: 'mom-diff', section: 'us-macro', kind: 'flow', freshness: BLS_EMPLOYMENT_MONTHLY },
  { seriesId: 'us-unemployment', source: 'fred', sourceCode: 'UNRATE', displayName: '失業率', unit: '%', frequency: 'monthly', transform: 'level', section: 'us-macro', kind: 'level', freshness: BLS_EMPLOYMENT_MONTHLY },
  { seriesId: 'us-m2-yoy', source: 'fred', sourceCode: 'M2SL', displayName: 'M2 年增率', unit: '%', frequency: 'monthly', transform: 'yoy', section: 'us-macro', kind: 'level', freshness: M2_MONTHLY },
  { seriesId: 'us-fed-funds', source: 'fred', sourceCode: 'FEDFUNDS', displayName: 'Fed funds 利率', unit: '%', frequency: 'monthly', transform: 'level', section: 'rates-markets', kind: 'level', freshness: FED_FUNDS_MONTHLY },
  { seriesId: 'us-10y-yield', source: 'fred', sourceCode: 'DGS10', displayName: '美債 10 年期殖利率', unit: '%', frequency: 'daily', transform: 'level', section: 'rates-markets', kind: 'level', freshness: US_TRADING_T2 },
  { seriesId: 'us-2y-yield', source: 'fred', sourceCode: 'DGS2', displayName: '美債 2 年期殖利率', unit: '%', frequency: 'daily', transform: 'level', section: 'rates-markets', kind: 'level', freshness: US_TRADING_T2 },
  // real-rate frame：名目 = 實質 + 通膨預期。DFII10 = 10Y TIPS 實質利率、T10YIE = 10Y breakeven 通膨預期。
  { seriesId: 'us-10y-real-rate', source: 'fred', sourceCode: 'DFII10', displayName: '美債 10 年期實質利率', unit: '%', frequency: 'daily', transform: 'level', section: 'rates-markets', kind: 'level', freshness: US_TRADING_T2 },
  { seriesId: 'us-10y-breakeven', source: 'fred', sourceCode: 'T10YIE', displayName: '10 年期通膨預期', unit: '%', frequency: 'daily', transform: 'level', section: 'rates-markets', kind: 'level', freshness: US_TRADING_T1 },
  { seriesId: 'us-yield-spread-10y2y', source: 'derived', sourceCode: '', displayName: '10Y-2Y 利差', unit: '%', frequency: 'daily', transform: 'spread', section: 'rates-markets', kind: 'level', freshness: US_TRADING_T2, spreadOf: ['us-10y-yield', 'us-2y-yield'] },
  { seriesId: 'usd-index', source: 'fred', sourceCode: 'DTWEXBGS', displayName: '美元指數（broad）', unit: '點', frequency: 'daily', transform: 'level', section: 'rates-markets', kind: 'level', freshness: FRED_H10_WEEKLY },
  { seriesId: 'wti-oil', source: 'fred', sourceCode: 'DCOILWTICO', displayName: 'WTI 原油', unit: '美元', frequency: 'daily', transform: 'level', section: 'rates-markets', kind: 'level', freshness: FRED_SPOT_WEEKLY },
  // 美股指數走 api.nasdaq.com 第一方端點、不走 FRED：FRED 的 Nasdaq 家族發布時戳為台北
  // 11:50 前後，比 pipeline 起跑（06:08–06:17）晚，接了只拿得到 T-1；而 SP500／DJIA 雖較早，
  // 但 S&P DJI 的 FRED series notes 明文禁止未經書面同意重製，故不採用。
  { seriesId: 'us-sox', source: 'nasdaq', sourceCode: 'SOX', displayName: '費城半導體指數', unit: '點', frequency: 'daily', transform: 'level', section: 'us-equity', kind: 'level', freshness: US_TRADING_T1 },
  { seriesId: 'us-nasdaq-comp', source: 'nasdaq', sourceCode: 'COMP', displayName: '納斯達克綜合指數', unit: '點', frequency: 'daily', transform: 'level', section: 'us-equity', kind: 'level', freshness: US_TRADING_T1 },
  { seriesId: 'usd-twd', source: 'fred', sourceCode: 'DEXTAUS', displayName: '美元兌台幣', unit: '元', frequency: 'daily', transform: 'level', section: 'taiwan', kind: 'level', freshness: FRED_H10_WEEKLY },
  { seriesId: 'taiex-close', source: 'twse', sourceCode: '/v1/exchangeReport/FMTQIK', displayName: '加權指數', unit: '點', frequency: 'daily', transform: 'level', section: 'taiwan', kind: 'level', freshness: TW_TRADING_T1 },
  // OpenAPI 的 BFI82U 已下架（404/302）。改用傳統 JSON API（legacy host www.twse.com.tw）、
  // 回傳含「合計」row 的官方買賣差額（單位：元）、parser 取合計 row 的「買賣差額」÷1e8 轉億元。
  { seriesId: 'taiex-institutional-net', source: 'twse', sourceCode: 'https://www.twse.com.tw/rwd/zh/fund/BFI82U?response=json', displayName: '三大法人買賣超', unit: '億元', frequency: 'daily', transform: 'level', section: 'taiwan', kind: 'flow', freshness: TW_TRADING_T1 },
  // OpenAPI 的 MI_MARGN 僅逐股張數（無全市場合計金額）。改用傳統 JSON API（legacy host）、
  // 取 tables[0] 信用交易統計「融資金額(仟元)」row 的「今日餘額」、×1000÷1e8（仟元→億元）。
  { seriesId: 'taiex-margin-balance', source: 'twse', sourceCode: 'https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN?response=json', displayName: '融資餘額', unit: '億元', frequency: 'daily', transform: 'level', section: 'taiwan', kind: 'level', freshness: TW_TRADING_T1 },
  // TAIFEX 三大法人-台指期(TXF) 外資未平倉多空淨額(口數)。官方欄位「外資及陸資」合計、
  // displayName 用業界簡稱「外資台指期淨部位」。負值=淨空、正值=淨多。
  { seriesId: 'foreign-taifex-net', source: 'taifex', sourceCode: 'TXF', displayName: '外資台指期淨部位', unit: '口', frequency: 'daily', transform: 'level', section: 'taiwan', kind: 'flow', freshness: TW_TRADING_T1 },
  // TWSE TWT93U 全市場借券賣出餘額（合計列 index 12 當日餘額、股÷1e8→億股）。空方 positioning 指標。
  { seriesId: 'taiex-sbl-balance', source: 'twse', sourceCode: 'https://www.twse.com.tw/rwd/zh/marginTrading/TWT93U?response=json', displayName: '借券賣出餘額', unit: '億股', frequency: 'daily', transform: 'level', section: 'taiwan', kind: 'level', freshness: TW_TRADING_T1 },
  // TWSE MI_MARGN（與融資餘額同端點）「融券(交易單位)」今日餘額（張、無換算）。散戶信用空方餘額。
  { seriesId: 'taiex-margin-short-balance', source: 'twse', sourceCode: 'https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN?response=json', displayName: '融券餘額', unit: '張', frequency: 'daily', transform: 'level', section: 'taiwan', kind: 'level', freshness: TW_TRADING_T1 },
]
