import { RELATIVE_TIME_USER_TEXT } from '../prompts/relative-time.user-content.js'

// 把新聞 publishedAt（UTC ISO）換成台北日期、對比報告日 briefDate（'YYYY-MM-DD'）
// 回相對時間標籤。用 publishedAt 而非市場時刻：報導發布時間已天然編碼區域時差
// （台股盤後落台北白天=昨日、美股盤後落台北凌晨=今日）。無法判定 → '' 不貼標籤。
const TAIPEI_DATE_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Taipei',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

export function relativeDayLabel(publishedAtIso: string | null | undefined, briefDate: string): string {
  if (!publishedAtIso)
    return ''
  const published = new Date(publishedAtIso)
  if (Number.isNaN(published.getTime()))
    return ''
  const taipeiDate = TAIPEI_DATE_FMT.format(published) // 'YYYY-MM-DD'（台北）
  const briefMs = Date.parse(`${briefDate}T00:00:00Z`)
  const newsMs = Date.parse(`${taipeiDate}T00:00:00Z`)
  if (Number.isNaN(briefMs) || Number.isNaN(newsMs))
    return ''
  const dayDiff = Math.round((briefMs - newsMs) / 86_400_000)
  if (dayDiff < 0)
    return ''
  if (dayDiff === 0)
    return RELATIVE_TIME_USER_TEXT.today
  if (dayDiff === 1)
    return RELATIVE_TIME_USER_TEXT.yesterday
  if (dayDiff === 2)
    return RELATIVE_TIME_USER_TEXT.dayBeforeYesterday
  return RELATIVE_TIME_USER_TEXT.daysAgo(dayDiff)
}
