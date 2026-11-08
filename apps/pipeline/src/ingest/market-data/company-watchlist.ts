export interface WatchlistEntry {
  code: string
  name: string
}

// 0050 大權值股起始名單（實作時對照最新成分/權重微調、之後好調）。
// 過濾以 code 比對；name 目前僅備查（title 用來源回傳的公司名）。
export const COMPANY_WATCHLIST: WatchlistEntry[] = [
  { code: '0050', name: '元大台灣50' },
  { code: '2330', name: '台積電' },
  { code: '2317', name: '鴻海' },
  { code: '2454', name: '聯發科' },
  { code: '2308', name: '台達電' },
  { code: '2382', name: '廣達' },
  { code: '2412', name: '中華電' },
  { code: '2881', name: '富邦金' },
  { code: '2882', name: '國泰金' },
  { code: '2303', name: '聯電' },
  { code: '3711', name: '日月光投控' },
  { code: '2891', name: '中信金' },
  { code: '2886', name: '兆豐金' },
  { code: '2884', name: '玉山金' },
  { code: '2357', name: '華碩' },
  { code: '3034', name: '聯詠' },
  { code: '2379', name: '瑞昱' },
  { code: '2345', name: '智邦' },
  { code: '2892', name: '第一金' },
  { code: '5880', name: '合庫金' },
  { code: '1301', name: '台塑' },
  { code: '1303', name: '南亞' },
  { code: '2002', name: '中鋼' },
  { code: '3008', name: '大立光' },
  { code: '1216', name: '統一' },
  { code: '2603', name: '長榮' },
]
