const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'] as const

export function formatBriefDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m)
    return iso
  const [, y, mo, d] = m
  const dt = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(dt.getTime()))
    return iso
  const wd = WEEKDAYS[dt.getUTCDay()] ?? ''
  return `${y} 年 ${Number(mo)} 月 ${Number(d)} 日 · 週${wd}`
}

export function formatMonthDay(iso: string): string {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(iso)
  if (!m)
    return iso
  const [, mo, d] = m
  return `${mo}/${d}`
}
