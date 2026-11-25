import { checkCompliance, stripViolatingProseBy } from '@suanomics/shared'

// 空白也拿掉：換行與空白在瀏覽器上不會把一個詞拆開給讀者看。
const MARKDOWN_MARKS = /[*_`~\s]/g

// 空行在 markdown 渲染成不同段落，對讀者是句界（#76）。比照 markdown-it：
// 先把 \r\n 與單獨的 \r 視為換行，空行只容許空格與 tab。
const LINE_BREAK = /\r\n?/g
const PARAGRAPH_BREAK = /\n[ \t]*\n/

// 兩種讀法任一命中就擋：全部壓平防拆字繞過；保留段落界防前段主詞替後段方向詞背書。
// 取聯集，結果只會比原本的全壓平更嚴；前提是 MARKDOWN_MARKS 拿掉所有空白，join('') 才等於舊判定。
function isBlocked(text: string): boolean {
  const paragraphs = text.replace(LINE_BREAK, '\n').split(PARAGRAPH_BREAK).map(p => p.replace(MARKDOWN_MARKS, ''))
  return checkCompliance(paragraphs.join('')) !== null || checkCompliance(paragraphs.join('\n')) !== null
}

/** 拿掉被 compliance 規則攔截的句子：切句與丟句與 pipeline 共用，判定用網站自己的 isBlocked（先去掉標記與空白）。 */
export function redactBlockedSentences(text: string): string {
  return stripViolatingProseBy(text, isBlocked)
}

// 網站只解析粗斜體（markdown.ts），刪句會拆散成對的 * 與 _，殘留的標記會印成字面符號或把後文誤開成粗體。
// 分不出哪些標記還成對，所以有刪句時整段拿掉，只損失這段的粗斜體；isBlocked 本來就忽略這些標記，合規判定不變。
// 兩側都是英數字的 _（如 US_10Y）是代號的一部分，保留。
const EMPHASIS_MARKS = /\*|(?<![A-Z0-9])_|_(?![A-Z0-9])/gi

/** 給會渲染成 markdown 的敘事欄位用。 */
export function redactBlockedMarkdown(text: string): string {
  const redacted = redactBlockedSentences(text)
  return redacted === text ? text : redacted.replace(EMPHASIS_MARKS, '')
}
