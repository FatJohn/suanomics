import { checkCompliance, stripViolatingProseBy } from '@suanomics/shared'

// 空白也拿掉：換行與空白在瀏覽器上不會把一個詞拆開給讀者看。
const MARKDOWN_MARKS = /[*_`~\s]/g

function isBlocked(text: string): boolean {
  return checkCompliance(text.replace(MARKDOWN_MARKS, '')) !== null
}

/** 拿掉被 compliance 規則攔截的句子，規則與 pipeline 共用 stripViolatingProse。 */
export function redactBlockedSentences(text: string): string {
  return stripViolatingProseBy(text, isBlocked)
}
