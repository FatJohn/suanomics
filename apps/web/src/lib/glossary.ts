export interface GlossaryEntry {
  /** 頁內唯一，用在 popover 的 id。 */
  id: string
  term: string
  aliases: readonly string[]
  /** 含有術語、但意思不同的寫法（「海外資金」裡的「外資」）；落在這些寫法裡的不標。 */
  excludes?: readonly string[]
  definition: string
}

export interface TermSegment { text: string, entry?: GlossaryEntry }

/** 片段外、同一段落裡的前後文字：行內標籤會把一句話切成好幾段。 */
export interface TermContext { before: string, after: string }

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

function insideExclude(text: string, start: number, form: string, excludes: readonly string[]): boolean {
  return excludes.some((ex) => {
    for (let k = ex.indexOf(form); k !== -1; k = ex.indexOf(form, k + 1)) {
      if (start - k >= 0 && text.startsWith(ex, start - k))
        return true
    }
    return false
  })
}

function longestMatchAt(text: string, start: number, entries: readonly GlossaryEntry[], seen: ReadonlySet<string>) {
  let best: { entry: GlossaryEntry, form: string } | undefined
  for (const entry of entries) {
    if (seen.has(entry.id))
      continue
    for (const form of [entry.term, ...entry.aliases]) {
      if (form.length > (best?.form.length ?? 0) && text.startsWith(form, start)
        && atWordBoundary(text, start, form) && !insideExclude(text, start, form, entry.excludes ?? [])) {
        best = { entry, form }
      }
    }
  }
  return best
}

/**
 * 把文字切成一般片段與術語片段。每個術語（含別名）在 seen 共用的範圍內只標第一次出現，
 * 標過的 id 會寫回 seen；同一位置有多個術語可比對時取最長的，「核心 CPI」不會被拆成 CPI。
 */
export function findTerms(text: string, entries: readonly GlossaryEntry[], seen: Set<string>, context: TermContext = { before: '', after: '' }): TermSegment[] {
  // 在接上前後文的整句裡比對，邊界與排除寫法才看得到片段外的字；只輸出片段本身。
  const full = context.before + text + context.after
  const end = context.before.length + text.length
  const segments: TermSegment[] = []
  let plain = ''
  let i = context.before.length
  while (i < end) {
    const found = longestMatchAt(full, i, entries, seen)
    const match = found && i + found.form.length <= end ? found : undefined
    if (!match) {
      plain += full[i]
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
// anchor 名稱明寫：有些瀏覽器支援 position-area，卻還不會把 popovertarget 的按鈕當成隱含錨點。
function termMarkup(text: string, entry: GlossaryEntry): string {
  const id = `term-${entry.id}`
  return `<button type="button" class="term" popovertarget="${id}" style="anchor-name: --${id}">${text}</button>`
    + `<span class="gloss" id="${id}" popover style="position-anchor: --${id}"><strong>${escapeHtml(entry.term)}</strong>${escapeHtml(entry.definition)}</span>`
}

// 段落與列表項是句子的邊界，前後文不跨過它們。
const BLOCK_TAG = /^<\/?(?:p|li)\b/

/**
 * 在已渲染的 HTML 裡標術語，只動標籤之間的文字。輸入是 markdown-it（關掉 html）或 escapeHtml 的輸出，
 * 文字裡不會有原始的 `<`，所以用標籤切開就夠；術語本身不含 `&`，不會切到 entity。
 */
export function annotateHtml(html: string, entries: readonly GlossaryEntry[], seen: Set<string>): string {
  const parts = html.split(/(<[^>]*>)/)
  const textAround = (from: number, step: 1 | -1): string => {
    const texts: string[] = []
    for (let j = from; j >= 0 && j < parts.length; j += step) {
      const part = parts[j] ?? ''
      if (BLOCK_TAG.test(part))
        break
      if (!part.startsWith('<'))
        texts.push(part)
    }
    return (step === 1 ? texts : texts.reverse()).join('')
  }
  return parts.map((part, i) => {
    if (part.startsWith('<'))
      return part
    const context = { before: textAround(i - 1, -1), after: textAround(i + 1, 1) }
    return findTerms(part, entries, seen, context).map(s => (s.entry ? termMarkup(s.text, s.entry) : s.text)).join('')
  }).join('')
}
