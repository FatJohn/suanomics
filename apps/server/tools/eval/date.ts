// 離線評測 CLI：CLI --date 純驗證（YYYY-MM-DD）。
// 抽純函式讓 CLI 殼薄、且可單元測試（scripts 屬寬鬆範圍、此為可抽就抽的小 increment）。
// 先正規表式擋格式、再回填 UTC Date 比對月日、擋掉 13 月 / 2/30 等格式對但不存在的日期、
// 避免非法值漏進 DB query（DB / 網路前擋是此 CLI 的設計意圖）。
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

export function isValidEvalDate(date: string): boolean {
  const m = DATE_RE.exec(date)
  if (!m)
    return false

  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])

  const d = new Date(Date.UTC(year, month - 1, day))
  return (
    d.getUTCFullYear() === year
    && d.getUTCMonth() === month - 1
    && d.getUTCDate() === day
  )
}
