export interface GlossaryEntry {
  /** 頁內唯一，用在 popover 的 id。 */
  id: string
  term: string
  aliases: readonly string[]
  definition: string
}

export interface TermSegment { text: string, entry?: GlossaryEntry }

const ASCII_WORD = /[A-Z0-9]/i

// 英文開頭或結尾的術語，那一端不能接英數字，否則 CPI 會比對到 CPIX；
// 中文沒有分詞邊界，中文那一端直接比對（「Fed funds 利率3.88%」照標）。
function atWordBoundary(text: string, start: number, form: string): boolean {
  const before = text[start - 1] ?? ''
  const after = text[start + form.length] ?? ''
  const startOk = !ASCII_WORD.test(form[0] ?? '') || !ASCII_WORD.test(before)
  const endOk = !ASCII_WORD.test(form.at(-1) ?? '') || !ASCII_WORD.test(after)
  return startOk && endOk
}

function longestMatchAt(text: string, start: number, entries: readonly GlossaryEntry[], seen: ReadonlySet<string>) {
  let best: { entry: GlossaryEntry, form: string } | undefined
  for (const entry of entries) {
    if (seen.has(entry.id))
      continue
    for (const form of [entry.term, ...entry.aliases]) {
      if (text.startsWith(form, start) && atWordBoundary(text, start, form) && form.length > (best?.form.length ?? 0))
        best = { entry, form }
    }
  }
  return best
}

/**
 * 把文字切成一般片段與術語片段。每個術語（含別名）在 seen 共用的範圍內只標第一次出現，
 * 標過的 id 會寫回 seen；同一位置有多個術語可比對時取最長的，「核心 CPI」不會被拆成 CPI。
 */
export function findTerms(text: string, entries: readonly GlossaryEntry[], seen: Set<string>): TermSegment[] {
  const segments: TermSegment[] = []
  let plain = ''
  let i = 0
  while (i < text.length) {
    const match = longestMatchAt(text, i, entries, seen)
    if (!match) {
      plain += text[i]
      i += 1
      continue
    }
    if (plain)
      segments.push({ text: plain })
    plain = ''
    segments.push({ text: match.form, entry: match.entry })
    seen.add(match.entry.id)
    i += match.form.length
  }
  if (plain)
    segments.push({ text: plain })
  return segments
}

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, c => HTML_ESCAPES[c] ?? c)
}

// popover 緊接在按鈕後面：螢幕閱讀器依 DOM 順序讀，展開後下一段就是解釋；不需要任何 script。
function termMarkup(text: string, entry: GlossaryEntry): string {
  const id = `term-${entry.id}`
  return `<button type="button" class="term" popovertarget="${id}">${text}</button>`
    + `<span class="gloss" id="${id}" popover><strong>${escapeHtml(entry.term)}</strong>${escapeHtml(entry.definition)}</span>`
}

/**
 * 在已渲染的 HTML 裡標術語，只動標籤之間的文字。輸入是 markdown-it（關掉 html）或 escapeHtml 的輸出，
 * 文字裡不會有原始的 `<`，所以用標籤切開就夠；術語本身不含 `&`，不會切到 entity。
 */
export function annotateHtml(html: string, entries: readonly GlossaryEntry[], seen: Set<string>): string {
  return html.split(/(<[^>]*>)/).map((part) => {
    if (part.startsWith('<'))
      return part
    return findTerms(part, entries, seen).map(s => (s.entry ? termMarkup(s.text, s.entry) : s.text)).join('')
  }).join('')
}
