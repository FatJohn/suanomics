/**
 * 讀者面首頁／歷史頁的載入接線：路由日期 → 兩個 store 各自要拿哪一天。
 *
 * 抽出來的唯一理由是**這一層本來零覆蓋**。`apps/web` 沒有元件測試基礎設施
 * （21 支測試全是純邏輯、沒有 @vue/test-utils），所以寫在 `HomeView.vue` 的 `load()`
 * 裡時，「有沒有把日期傳給 market store」這一步沒有任何測試守得到——驗收實測把那個
 * 參數拿掉，全 suite 照樣全綠，而那正是要修的行為。
 */

export interface ReaderLoadTargets {
  fetchBriefByDate: (date: string) => void
  fetchDailyBrief: () => void
  fetchKeyNumbers: (date?: string) => void
}

/**
 * vue-router 的 `params.date` 型別是 `string | string[]`（重複 query 或自訂 matcher 都可能
 * 給陣列），空字串也要當成沒有——兩者都退回「今日」。
 */
export function readerRouteDate(raw: unknown): string | undefined {
  return typeof raw === 'string' && raw ? raw : undefined
}

/**
 * 兩個 store 一律拿**同一個**日期：正文與關鍵數字並排顯示，時間基準不同就是這裡要防的病。
 */
export function loadReaderView(targets: ReaderLoadTargets, rawDate: unknown): void {
  const date = readerRouteDate(rawDate)
  if (date)
    targets.fetchBriefByDate(date)
  else
    targets.fetchDailyBrief()
  targets.fetchKeyNumbers(date)
}
