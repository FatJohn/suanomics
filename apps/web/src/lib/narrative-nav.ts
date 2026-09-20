export function sectionDomId(index: number): string {
  return `narrative-sec-${index}`
}

const SNIPPET_MAX = 16

// 舊格式 brief 的 section 可能沒有 heading（runtime null/空白）、
// 此時退而求其次：從 body 首行截一段當目錄標籤、避免空白 heading
export function sectionLabel(
  heading: string | null | undefined,
  body: string,
  index: number,
): string {
  const trimmedHeading = (heading ?? '').trim()
  if (trimmedHeading)
    return trimmedHeading

  const firstLine = (body ?? '')
    .split('\n')[0]
    ?.replace(/^[#>\-*\s]+/, '') // 去掉行首 markdown 標記（#、>、-、* 與空白）
    .trim() ?? ''

  if (!firstLine)
    return `第 ${index + 1} 段`

  if (firstLine.length > SNIPPET_MAX)
    return `${firstLine.slice(0, SNIPPET_MAX)}…`

  return firstLine
}
