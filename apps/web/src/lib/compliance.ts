import { checkCompliance } from '@suanomics/shared'

const SENTENCE_END = /(?<=[。！？!?\n])/
// 空白也拿掉：換行與空白在瀏覽器上不會把一個詞拆開給讀者看。
const MARKDOWN_MARKS = /[*_`~\s]/g

function isBlocked(text: string): boolean {
  return checkCompliance(text.replace(MARKDOWN_MARKS, '')) !== null
}

/**
 * 拿掉被 compliance 規則攔截的句子。
 *
 * 逐句過濾後要再檢查一次整段：個股與方向詞的鄰近判定會跨句，單句都乾淨不代表整段乾淨，
 * 這種情況分不出該拿掉哪一句，整段不顯示。
 */
export function redactBlockedSentences(text: string): string {
  const kept = text.split(SENTENCE_END).filter(s => !isBlocked(s)).join('')
  return isBlocked(kept) ? '' : kept
}
