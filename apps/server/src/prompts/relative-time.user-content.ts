// relative-time.ts 的 user content 文字：把新聞發布時間換算成相對報告日的標籤
// （今日／昨日／前日／N天前），插進各 agent 的 user content 供模型判斷時間框架。
export const RELATIVE_TIME_USER_TEXT = {
  today: '今日',
  yesterday: '昨日',
  dayBeforeYesterday: '前日',
  daysAgo: (dayDiff: number) => `${dayDiff}天前`,
}
