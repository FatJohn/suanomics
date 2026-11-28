const CLOSING = '，、。：；！？）」』】》〉'
const OPENING = '（「『【《〈'
const HAN_WORD = /^\p{Script=Han}{2,}$/u

function splitPhrases(text: string): string[] {
  const phrases: string[] = []
  let current = ''
  for (const ch of text) {
    const last = current.at(-1)
    const afterClosing = last !== undefined && CLOSING.includes(last) && !CLOSING.includes(ch)
    const beforeOpening = last !== undefined && OPENING.includes(ch) && !OPENING.includes(last)
    if (afterClosing || beforeOpening) {
      phrases.push(current)
      current = ''
    }
    current += ch
  }
  if (current)
    phrases.push(current)
  return phrases
}

// Node 的 ICU 詞典偏簡體，繁體常被切成單字（台|股、通|膨），單字邊界不可信；
// 只有前後都是兩字以上的漢字詞時才當斷點，寧可少斷也不拆詞。
const segmenter = new Intl.Segmenter('zh-Hant', { granularity: 'word' })

function splitChunks(phrase: string): string[] {
  const chunks: string[] = []
  let prev = ''
  for (const { segment, isWordLike } of segmenter.segment(phrase)) {
    const word = isWordLike ? segment : ''
    if (chunks.length > 0 && HAN_WORD.test(prev) && HAN_WORD.test(word))
      chunks.push(segment)
    else if (chunks.length > 0)
      chunks[chunks.length - 1] += segment
    else
      chunks.push(segment)
    prev = word
  }
  return chunks
}

/**
 * 標題切成片語、片語再切成可斷行的塊（DESIGN.md The Keep-All Rule）：片語依全形標點切，
 * 收尾標點黏在前一個片語、開括號黏在後一個，所以行首不會是標點；片語內只在兩個多字詞之間斷。
 * 所有塊接起來等於原標題。
 */
export function headlinePhrases(text: string): string[][] {
  return splitPhrases(text).map(splitChunks)
}
