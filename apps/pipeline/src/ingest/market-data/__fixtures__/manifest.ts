import type { FixtureManifest } from '../../fixtures/manifest.js'

// URL 逐條對過 series-config.ts 的 sourceCode 與各 source 檔的常數，不是憑印象寫的。
export const marketDataFixtures: FixtureManifest = {
  baseUrl: import.meta.url,
  label: 'market-data',
  entries: [
    {
      file: 'twse-fmtqik.json',
      kind: 'json',
      origin: 'unverified',
      url: 'https://openapi.twse.com.tw/v1/exchangeReport/FMTQIK',
      shapeVerifiedAt: '2026-08-22',
      transform: 'truncated',
      note: 'series taiex-close。內容看起來是真實擷取（民國日期、實際成交金額量級），但無抓取紀錄。2026-08-22 的 fixtures:check 形狀對得上——那證明的是形狀有現實依據，不是這份檔案當初真的抓自那裡，所以 origin 仍是 unverified。',
    },
    {
      file: 'twse-bfi82u-legacy.json',
      kind: 'json',
      origin: 'unverified',
      url: 'https://www.twse.com.tw/rwd/zh/fund/BFI82U?response=json',
      shapeVerifiedAt: '2026-08-22',
      transform: 'truncated',
      note: 'series taiex-institutional-net。傳統 JSON API：{stat, date, fields, data}，欄位靠 fields index 對照，不是具名欄位——所以形狀比對抓不到「欄位順序換了」這種漂移，那要靠 fields 陣列的內容。',
    },
    {
      file: 'twse-mi-margn-legacy.json',
      kind: 'json',
      origin: 'unverified',
      url: 'https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN?response=json',
      shapeVerifiedAt: '2026-08-22',
      transform: 'truncated',
      note: 'taiex-margin-balance 與 taiex-margin-short-balance 共用同一個 URL。',
    },
    {
      file: 'twse-twt93u-legacy.json',
      kind: 'json',
      origin: 'unverified',
      url: 'https://www.twse.com.tw/rwd/zh/marginTrading/TWT93U?response=json',
      shapeVerifiedAt: '2026-08-22',
      transform: 'truncated',
      note: 'series taiex-sbl-balance（借券賣出餘額）。合計列在 data 的 r[1]、index 12。',
    },
    {
      file: 'twse-twt48u.json',
      kind: 'json',
      origin: 'unverified',
      url: 'https://openapi.twse.com.tw/v1/exchangeReport/TWT48U_ALL',
      shapeVerifiedAt: '2026-08-22',
      transform: 'truncated',
      note: '除權息預告（ex-dividend-source.ts 的 TWT48U_ENDPOINT）。',
    },
    {
      file: 'mops-t100sb02.html',
      kind: 'opaque',
      origin: 'unverified',
      url: 'https://mopsov.twse.com.tw/mops/web/ajax_t100sb02_1',
      transform: 'truncated',
      note: '法說會（investor-conference-source.ts 的 MOPS_ENDPOINT）。★ 是 POST + 表單參數，不是 GET，所以 fixtures:check 打不了；要重抓得照那支檔的請求組。內容含真實個股（2330 台積電、1432 大魯閣）與民國日期。',
    },
  ],
}
