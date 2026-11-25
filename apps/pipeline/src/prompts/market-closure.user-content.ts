// 休市後第一個交易日送給 editor 與 narrative-writer 的統整指示（agents/market-closure.ts 組裝）。
// 放這裡是為了跟其他 user content 模板一樣，換語言／市場時整份替換。
export const MARKET_CLOSURE_USER_TEXT = {
  heading: '## 休市後第一個交易日（統整休市期間）',
  summaryLine: (previousTradingDay: string, closedRange: string, calendarDays: number): string =>
    `今天是休市後第一個交易日：上一個交易日是 ${previousTradingDay}，${closedRange} 台股休市，距上一個交易日 ${calendarDays} 天。`,
  coverageLine: '素材涵蓋上一個交易日收盤後到今天開盤前的整段休市期間。請統整這段期間的重要事件，不要只看最近一晚；同一事件在休市期間有後續發展時，以最新進展為準並交代先後順序。',
  // system prompt 的時間標籤規則以一般交易日為前提，這裡交代今天它們指哪一天，避免兩邊指示互相矛盾。
  datingLine: (previousTradingDay: string): string =>
    `其他段落說的「昨日收盤」「前夜美股」今天分別是 ${previousTradingDay}的台股收盤與那之後最近一次的美股交易，但今天不用這兩個標籤：一律寫出日期（例：「9/26（六）」），也不要用「昨夜」「前一晚」概括整段休市期間。`,
  complianceLine: (phrases: string): string => `統整時同樣不得出現下列投信投顧法禁用語：${phrases}`,
}
