// 休市後第一個交易日送給 editor 與 narrative-writer 的統整指示（agents/market-closure.ts 組裝）。
// 放這裡是為了跟其他 user content 模板一樣，換語言／市場時整份替換。
export const MARKET_CLOSURE_USER_TEXT = {
  heading: '## 休市後第一個交易日（統整休市期間）',
  summaryLine: (previousTradingDay: string, closedRange: string, calendarDays: number): string =>
    `今天是休市後第一個交易日：上一個交易日是 ${previousTradingDay}，${closedRange} 台股休市，距上一個交易日 ${calendarDays} 天。`,
  coverageLine: '素材涵蓋上一個交易日收盤後到今天開盤前的整段休市期間。請統整這段期間的重要事件，不要只看最近一晚；同一事件在休市期間有後續發展時，以最新進展為準並交代先後順序。',
  datingLine: '提到休市期間的事件時寫出日期（例：「9/26（六）」），不要用「昨夜」「前一晚」概括整段期間。',
  complianceLine: (phrases: string): string => `統整時同樣不得出現下列投信投顧法禁用語：${phrases}`,
}
