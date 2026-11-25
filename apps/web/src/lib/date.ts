const TAIPEI_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' })

export function formatTaipeiDate(date: Date): string {
  return TAIPEI_DATE.format(date)
}
