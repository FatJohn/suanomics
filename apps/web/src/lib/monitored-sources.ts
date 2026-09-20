/**
 * 我們監測的新聞頻道。
 *
 * 這份清單與佐證層的「報告用到的來源」（`brief-sources.ts`）是兩件事，別混用：
 * 這裡是**覆蓋面**（我們在盯什麼），那裡是**當日證據**（這一篇實際引用了什麼）。
 * 2026-08-02 之前兩份都叫「來源」、在同一頁上讀起來像同一批東西，命名因此拉開。
 *
 * **資料是 `packages/db/src/seed-external-sources.ts` 的手抄快照**——web 不依賴
 * `@suanomics/db`（也不該為了一頁靜態清單去依賴它）。對齊靠 `seedSlug` 與同目錄那支測試的
 * 跨檔守衛（讀 seed 原始碼比對 slug 集合與聚合器標記），不是靠人記得回來對一次。
 *
 * **停用的來源不列在這裡**：seed 可以把某個來源標成 `enabled: false`（例如 2026-08-22
 * 停用的 udn 兩家），那種來源實際上不會被抓，掛在「我們監測什麼」這一頁
 * 上就是對讀者不實。同目錄的守衛測試比對的是 seed 裡**啟用中**的 slug 集合。
 *
 * **`label` 是給讀者的分組，不是 seed 的分類**。seed 按主題分（#1 海外地緣、#5 戰爭衝突…），
 * 這裡按讀者認得的身分分（財經媒體／官方機構／智庫）。兩者可以不同，但**不得互相矛盾**：
 * 最初版本把 BBC World、Al Jazeera、SCMP、Reuters World 放進「國際財經媒體」，
 * 而 seed 自己把它們歸在地緣政治與戰爭衝突——獨立複查抓到，改成現在的分組。
 */

export interface MonitoredSource {
  name: string
  /** 對應 `seed-external-sources.ts` 的 slug。跨檔守衛測試靠它做身分比對，不是比數量。 */
  seedSlug: string
  /** 發布這則消息的機構本身是官方／監管／央行。chip 的 --official 變體吃這個欄位。 */
  official?: boolean
  /**
   * 這一條是經 Google News 聚合取得，不是直連該機構或媒體自己的 feed。
   *
   * 它與 `official` **正交**：White House 與 IEA 兩條同時是官方發布者、也同時走聚合器。
   * 最初版本只在頁面上寫了一句「部分國際媒體與智庫是經 Google News 聚合取得」，
   * 而那兩條正好被排在官方那組、旁邊寫著「不經媒體轉述」——讀者拿到的說明與資料相反。
   * 獨立複查抓到之後改成逐條標記：範圍句會寫錯，欄位不會。
   */
  viaAggregator?: boolean
}

export interface MonitoredSourceGroup {
  label: string
  sources: MonitoredSource[]
}

export const MONITORED_SOURCE_GROUPS: MonitoredSourceGroup[] = [
  {
    label: '台灣財經媒體',
    sources: [
      { name: '鉅亨網', seedSlug: 'anue' },
      { name: '自由財經', seedSlug: 'liberty-finance' },
      { name: '鉅亨國際', seedSlug: 'cnyes-global' },
    ],
  },
  {
    label: '國際財經媒體',
    sources: [
      { name: 'Reuters Business', seedSlug: 'reuters-biz', viaAggregator: true },
      { name: 'Bloomberg', seedSlug: 'bloomberg-markets' },
      { name: 'WSJ', seedSlug: 'wsj-markets', viaAggregator: true },
      { name: 'CNBC', seedSlug: 'cnbc-markets' },
      { name: 'OilPrice', seedSlug: 'oilprice' },
    ],
  },
  {
    label: '國際新聞 / 地緣政治',
    sources: [
      { name: 'Reuters World', seedSlug: 'reuters-world', viaAggregator: true },
      { name: 'BBC World', seedSlug: 'bbc-world' },
      { name: 'Al Jazeera', seedSlug: 'aljazeera' },
      { name: 'SCMP', seedSlug: 'scmp-world' },
    ],
  },
  {
    label: '台灣官方機構',
    sources: [
      { name: '公開資訊觀測站', seedSlug: 'twse-mops-news', official: true },
      { name: '台灣證交所', seedSlug: 'twse-announcements', official: true },
      { name: '金管會', seedSlug: 'fsc-news', official: true },
      { name: '中央銀行', seedSlug: 'cbc-press', official: true },
      { name: '行政院', seedSlug: 'ey-press', official: true },
    ],
  },
  {
    label: '國際官方機構',
    sources: [
      { name: 'Fed FOMC', seedSlug: 'fomc-statements', official: true },
      { name: 'White House', seedSlug: 'whitehouse-statements', official: true },
      { name: 'EIA 美國能源', seedSlug: 'eia', official: true },
      { name: 'IEA 國際能源', seedSlug: 'iea', official: true, viaAggregator: true },
    ],
  },
  {
    label: '台灣政治 / 綜合新聞',
    sources: [
      { name: '中央社', seedSlug: 'cna-politics' },
      { name: '自由時報國際', seedSlug: 'liberty-international' },
    ],
  },
  {
    label: '智庫 / 政策研究',
    sources: [
      { name: 'CSIS', seedSlug: 'csis', viaAggregator: true },
      { name: 'Brookings', seedSlug: 'brookings', viaAggregator: true },
      { name: 'ISW', seedSlug: 'isw', viaAggregator: true },
    ],
  },
]

export const TOTAL_MONITORED_SOURCES: number = MONITORED_SOURCE_GROUPS
  .reduce((acc, g) => acc + g.sources.length, 0)
