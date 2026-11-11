import { checkCompliance, stripViolatingProseBy } from '@suanomics/shared'

// 空白也拿掉：換行與空白在瀏覽器上不會把一個詞拆開給讀者看。
const MARKDOWN_MARKS = /[*_`~\s]/g

function isBlocked(text: string): boolean {
  return checkCompliance(text.replace(MARKDOWN_MARKS, '')) !== null
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
