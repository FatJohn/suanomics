/**
 * 報告日 ＝ `Asia/Taipei` 的曆日。UTC 曆日在本系統中不是任何東西的報告日。
 *
 * 這是全 repo 唯一一份「今天」的實作。之所以要收斂：若排程排在 21:10 UTC 觸發，
 * 那是**前一個** UTC 曆日、卻是台北的當日 05:10——寫入路徑上任何一處自己用 UTC 算今天，
 * 就會安靜地把 job 建在前一天，而且沒有任何測試會紅。
 *
 * 用法邊界：**寫入路徑不得拿它當預設**。
 * `POST /internal/*` 缺日期是呼叫端的 bug、應該 422；只有讀取端點
 * （`GET /api/ops/publication-status`、`GET /api/market/snapshot`）與檔名戳記可以用它當預設。
 *
 * en-CA locale 的日期格式即 YYYY-MM-DD、且自帶零填補。
 */
export function taipeiDateOf(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(now)
}
